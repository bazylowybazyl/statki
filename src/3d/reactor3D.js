// src/3d/reactor3D.js
//
// MODELE REAKTORA w scenie Core3D — bez własnego renderera. Geometria:
// reactor3DShapes.js (tokamak Terra Nova, prowizorka piratów, podwójny
// pierścień Atlasa — każdy w swojej OBUDOWIE). Stan (komora, osłona, stopienie) czyta z runtime rdzeni
// na kadłubach belkowych (src/game/reactorCore.js) — nic nie zmienia w gameplayu.
//
// WIDOCZNOŚĆ: reaktor stoi NA WIERZCHU kadłuba (wzór: bryła mostka — bridge3D.js), w obudowie, przez cały
// czas — każdy rdzeń gospodarza z kadłubem (NOMINALNY też). Podłoga modelu leży tuż nad pokładem
// (TUNE.zBase), dach wnętrza zScale × skala nad nią, pokrywa obudowy tuż nad dachem. Obraz idzie za stanem:
//   • osłona komory cała — obudowa zamknięta, plazma świeci przez kratę;
//   • martwe komórki komory — sektory pokrywy nad nimi (i od strony uszkodzenia) zdjęte, poszarpany
//     i przypalony brzeg (maska w instancji, liczona tylko przy zmianie liczników komory);
//   • ODSŁONIĘTY — pokrywa rozbita nad wyrwą, widać cewki i plazmę;
//   • KRYTYCZNY, STOPIENIE — plazma szybciej, cewki pękają i żarzą się, pancerz obudowy pęka żarem, krata
//     grzeje się (puls jak żar 1,2 → 7 Hz);
//   • po detonacji: wyrzut i kula zostawiają wrak reaktora (detonated(); plazma gaśnie w 0,25 s, żar
//     stygnie, wyrzut wyrywa łuk konstrukcji), pozostałe warianty wyparowują model razem z komorą.
//
// PASS: warstwa 0 (ortho, jak kadłuby i mostki): konstrukcja nieprzezroczysta z zapisem głębi
// (renderOrder 12), plazma addytywnie (13; między cewkami i przez kratę), CIEŃ obudowy na kadłubie
// (11; czworokąt POD kadłubem z depthFunc GREATER — jak cień mostka: przycięty do sylwetki, bez wyrw).
// Efekty przezroczyste passa ortho rysują się po nim, więc wybuch nad reaktorem nie znika pod obudową.
//
// ŚWIATŁO: obudowa — słońce jak kadłub (kierunek do słońca w układzie modelu z instancji; człon słońca
// × sunVisibility(), otoczenie × sunFill — sunShadowMask.js), plazma prześwituje na brzegi kraty. Wnętrze
// (cewki, szyny, podłoga) oświetla wyłącznie własna plazma (pierścień jako źródło liniowe, u Atlasa też kula
// rdzenia), liczona w układzie modelu. Pasma HDR jak żar (coreBands.js): plazma — ciało 0,62 / 0,72 / 0,84,
// biała nić 9–11,5 z ostrą krawędzią; metal i pancerz pod progiem bloomu (≤ ~0,86), świecą wskaźnik,
// żar pęknięć i plazma.
//
// MASKOWANIE, MGŁA, MODELE 3D: rdzenie przychodzą z list widocznych (mgła wojny jak kadłub); `visibility`
// (gra: 0 przy „Statkach 3D”, maskowanie — entityCloakVisAt w środku rdzenia) poniżej TUNE.visMin chowa
// instancję (jak wieże 3D: próg 0,5). Obudowa gaśnie z komórką kadłuba pod sobą przez maskę sektorów.
//
// SKALA I WARIANT są parametrami rdzenia, nie stałą kadłuba (etap 2 kreatora: poziomy R1–R6):
// `core.model` (reactorCore.js z markera) — housingR (promień obrysu obudowy [j. świata] = obrys gniazda
// w kreatorze), housing (false — wnętrze bez obudowy), kind (rodzaj modelu). Bez parametrów — skala =
// promień komory, rodzaj z gospodarza (resolveReactorKind).
//
// PRECYZJA (AGENTS.md): świat gry leży przy 5–10 mln j., a float32 na GPU ma
// tam krok ~1 j. Środki instancji są więc WZGLĘDEM początku przy kamerze (sync(..., { sceneOrigin })
// z sceneOriginNearCamera, src/3d/sceneOrigin.js; bez niego — pierwszy
// widoczny rdzeń), początek siedzi w mesh.position, a shader liczy
// modelViewMatrix × pozycja (three składa macierz w double). Dane przepisywane
// co klatkę, więc początek też co klatkę. Wzór: Bridge3D._setOrigin
// (docs/PORT-mostki.md § 8.12). Moduł nie importuje sceneOrigin.js (ten ciągnie
// core3d.js) — testy node działają na samej scenie.
//
// Koszt: najwyżej 3 wywołania rysowania na rodzaj (konstrukcja, plazma, cień), tylko gdy jest widoczna
// instancja; dane instancji w JEDNYM przeplecionym buforze na rodzaj (R3_INSTANCE_LAYOUT), wysyłka zakresem
// bez alokacji; poza kadrem i poniżej TUNE.minPx na ekranie — bez instancji.
//
// Port WebGPU (zadanie 15): materiały w TSL (reactor3D.tsl.js), graf raz na
// rodzaj (cień — jeden na wszystkie). Atrybuty wierzchołka modelu w jednym przeplecionym buforze.
import * as THREE from 'three/webgpu';
// Stany z coreModel.js; ramę rdzenia na kadłubie belkowym podaje wołający (frameOf — src/game/reactorCore.js).
import { CORE_STATE, coreStateRank } from '../game/coreModel.js';
import { RenderWorld } from '../render/renderWorld.js';
import { CORE_FX_BANDS, coreStateBand } from './coreBands.js';
import { REACTOR3D_HOUSING, REACTOR3D_HUB_SECTOR, REACTOR3D_KINDS, buildReactorModel, reactorHousingSector } from './reactor3DShapes.js';
import { fxRandom } from './fx/fxRandom.js';
import {
  R3_INSTANCE_LAYOUT, createReactorPlasmaMaterial, createReactorShadowMaterial, createReactorStructMaterial
} from './reactor3D.tsl.js';

export const REACTOR3D_TUNE = {
  ambient: 0.05,        // wnętrze pod pancerzem: prawie ciemno
  lightGain: 1.45,      // światło plazmy na konstrukcji (× ciało plazmy)
  falloff: 3.5,         // 1 / (1 + d² · falloff), d w promieniach komory
  accentL: 0.7,         // listwy i akcenty — barwa bez bloomu
  zBase: 0.35,          // podłoga modelu nad pokładem (kadłub z ≈ 0) [j.]
  zScale: 0.34,         // wysokość wnętrza (podłoga → dach cewek) × skala modelu
  streaks: 7,           // jasne pasma krążące w pierścieniu
  filament: 0.016,      // półszerokość białej linii na szczycie rury (v rury; 0,25 = ćwierć obwodu)
  packet: 0.9,          // próg pasma, od którego pakiet plazmy świeci bielą (0–1)
  burnCool: 2.2,        // s — stygnięcie wraku reaktora (e^(−t/τ))
  plasmaOut: 0.25,      // s — gaśnięcie plazmy po wyrzucie/kuli
  // Obudowa (jak kadłub: SHIP_LIGHT_DEFAULTS w hexShips3D.js — otoczenie 0,24, rozproszone 1,18, połysk 0,30).
  houseAmbient: 0.24,
  houseDiffuse: 1.18,
  houseSpecular: 0.3,
  plasmaBleed: 0.35,    // światło plazmy na obudowie (× to, co dostaje wnętrze)
  crackGlow: 1.0,       // żar pęknięć pancerza w KRYTYCZNYM / STOPIENIU
  scorch: 0.7,          // przyciemnienie przypalonego brzegu zdjętego sektora
  // Cień na kadłubie (jak mostek: „słońce cieni” na 30°).
  shadow: true,
  shadowElevDeg: 30,
  shadowStrength: 0.45,
  shadowAo: 0.3,
  receiverZ: -0.6,      // czworokąt cienia pod kadłubem (0) i płytą pancerza (−0,25)
  // Widoczność.
  visMin: 0.5,          // maskowanie / „Statki 3D”: poniżej — bez instancji (jak wieże 3D)
  minPx: 2.5            // promień obrysu obudowy na ekranie [px], poniżej którego model się nie rysuje
};
if (typeof window !== 'undefined') window.__reactor3DTune = REACTOR3D_TUNE;

// Instancji na rodzaj (każdy okręt z rdzeniem w kadrze; poza kadrem bez instancji).
export const REACTOR3D_CAPACITY = 256;
const STRUCT_RENDER_ORDER = 12;   // kadłub 10, cień mostka 11, bryła mostka 12
const SHADOW_RENDER_ORDER = 11;
const PLASMA_RENDER_ORDER = 13;
const MAX_COILS = 32;
const L = R3_INSTANCE_LAYOUT;
const STRIDE = L.stride;
const DEG = Math.PI / 180;

// Obroty plazmy na sekundę i niestabilność rury wg stanu.
function flowRevPerSec(core, band) {
  if (core.state === CORE_STATE.MELTDOWN) return 0.8 + 1.7 * band.prog * band.prog;
  if (core.state === CORE_STATE.CRITICAL) return 0.6;
  return 0.35;
}
function instability(core, band) {
  if (core.state === CORE_STATE.MELTDOWN) return 0.25 + 0.65 * band.prog;
  if (core.state === CORE_STATE.CRITICAL) return 0.18;
  return 0.05;
}
function coilHeat(core, band) {
  if (core.state === CORE_STATE.MELTDOWN) return 0.25 + 0.6 * band.prog * band.prog;
  if (core.state === CORE_STATE.CRITICAL) return 0.15;
  return 0;
}
// Pęknięte cewki rosną z utratą osłony (część zawsze zostaje).
function brokenFrac(core) {
  const integ = Number.isFinite(core.integrity) ? core.integrity : 1;
  return Math.max(0, Math.min(0.85, (1 - integ) * 1.1));
}

/**
 * Rodzaj modelu dla rdzenia: parametr rdzenia (`core.model.kind`), gracz → atlas, piraci → pirate,
 * reszta → terran. Gra może podać własne `kindFor` (np. po frakcji albo ramie kadłuba).
 */
export function resolveReactorKind(core) {
  const mk = core?.model?.kind;
  if (mk && REACTOR3D_KINDS.includes(mk)) return mk;
  const h = core?.host;
  if (!h) return 'terran';
  if (h.isPlayer || h.shipFrame === 'atlas' || h.__hullId === 'atlas') return 'atlas';
  const id = String(h.__hullId || h.shipFrame || h.type || '').toLowerCase();
  const fac = String(h.faction || h.factionId || '').toLowerCase();
  if (id.includes('pirate') || id.includes('skull') || fac.includes('pira')) return 'pirate';
  return 'terran';
}

/**
 * Skala modelu [j. świata] (jednostka geometrii z reactor3DShapes.js) dla rdzenia rodzaju `kind`:
 * promień obrysu obudowy z parametru rdzenia (`core.model.housingR`) / obrys rodzaju, bez parametru —
 * promień komory `chamberR` (rama rdzenia).
 */
export function reactorModelScale(core, kind, chamberR) {
  const hr = Number(core?.model?.housingR);
  const outer = (REACTOR3D_HOUSING[kind] || REACTOR3D_HOUSING.terran).outer;
  if (Number.isFinite(hr) && hr > 0) return hr / outer;
  return Number.isFinite(chamberR) && chamberR > 0 ? chamberR : 1;
}

// Ziarno z uid rdzenia: liczba albo napis (dawne rdzenie `core_<base36>`) — dawniej `uid | 0`
// z napisu dawało 0 i wszystkie reaktory pękały w tych samych cewkach.
function uidHash(uid) {
  if (typeof uid === 'number' && Number.isFinite(uid)) return uid | 0;
  const str = String(uid ?? '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h | 0;
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function hexToLinear(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return new THREE.Vector3(srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255));
}
function luminance(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function parseColor(col, fallback) {
  if (Array.isArray(col) && col.length >= 3) return [Number(col[0]) || 0, Number(col[1]) || 0, Number(col[2]) || 0];
  if (typeof col === 'string' && /^#?[0-9a-f]{6}$/i.test(col)) {
    const v = hexToLinear(col);
    return [v.x, v.y, v.z];
  }
  return fallback;
}

// Atrybuty wierzchołka modelu w jednym przeplecionym buforze (limit 8
// buforów wierzchołków na pipeline). Kopia — model rodzaju (reactor3DShapes) zostaje bez zmian.
function interleaveGeometry(base, target) {
  const entries = Object.entries(base.attributes);
  const count = entries.length ? entries[0][1].count : 0;
  let stride = 0;
  for (const [, attr] of entries) stride += attr.itemSize;
  const data = new Float32Array(count * stride);
  const buffer = new THREE.InterleavedBuffer(data, stride);
  let offset = 0;
  for (const [name, attr] of entries) {
    const size = attr.itemSize;
    const src = attr.array;
    for (let i = 0; i < count; i++) {
      const o = i * stride + offset;
      for (let k = 0; k < size; k++) data[o + k] = src[i * size + k];
    }
    target.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
    offset += size;
  }
  return target;
}

// Dane instancji rodzaju w jednym przeplecionym buforze (R3_INSTANCE_LAYOUT) — wspólne dla konstrukcji,
// plazmy i cienia.
function setInstanceLayout(geometry, buffer) {
  for (const [name, offset] of Object.entries(L)) {
    if (name === 'stride') continue;
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, 4, offset));
  }
}

// Zakres wysyłki bez alokacji (addUpdateRange tworzy obiekt na wywołanie — wzór commitAttr w bridge3D.js).
function commitBuffer(buffer, count) {
  if (count <= 0) return;
  const ranges = buffer.updateRanges;
  if (Array.isArray(ranges)) {
    const r = buffer.__r3Range || (buffer.__r3Range = { start: 0, count: 0 });
    r.start = 0;
    r.count = count * STRIDE;
    ranges.length = 0;
    ranges.push(r);
  }
  buffer.needsUpdate = true;
}

// Czworokąt cienia (x, y ∈ [−0,5; 0,5]) — rozciąga go shader.
function receiverQuad() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/**
 * @param {object} options
 *   scene — THREE.Scene (Core3D.scene), layer — warstwa (0 — pass ortho), markLayerActive (warstwa ≠ 0),
 *   kindFor(core) → 'terran' | 'pirate' | 'atlas', colorFor(core) → [r, g, b],
 *   frameOf(core, out) → out { x, y, axX, axY, ayX, ayY, R, cs } — WYMAGANA rama rdzenia w świecie gry
 *     (środek, wektor promienia komory wzdłuż +x sprite'a i w dół obrazka, promień komory, bok komórki siatki);
 *     podaje ją rdzeń na kadłubie belkowym (src/game/reactorCore.js reactorCoreFrame — w grze z pozą renderu).
 *   hostReady(host) → bool — kadłub gospodarza istnieje (gra: reactorHull(host); domyślnie: jest i nie martwy).
 *   visibility(core, x, y) → 0..1 — maskowanie / „Statki 3D” (domyślnie 1).
 *   sunOf() → { x, y } — słońce w świecie gry (domyślnie RenderWorld.sun).
 */
export function createReactor3D(options = {}) {
  const scene = options.scene;
  if (!scene) throw new Error('createReactor3D: wymagana scena');
  if (typeof options.frameOf !== 'function') throw new Error('createReactor3D: wymagana rama rdzenia (frameOf)');
  const layer = Number.isFinite(options.layer) ? options.layer : 0;
  const markLayerActive = typeof options.markLayerActive === 'function' ? options.markLayerActive : null;
  const kindFor = typeof options.kindFor === 'function' ? options.kindFor : resolveReactorKind;
  const colorFor = typeof options.colorFor === 'function' ? options.colorFor : () => [0.3, 0.7, 1.0];
  const frameOf = options.frameOf;
  const hostReady = typeof options.hostReady === 'function' ? options.hostReady : (h) => !!h && !h.dead;
  const visibility = typeof options.visibility === 'function' ? options.visibility : null;
  const sunOf = typeof options.sunOf === 'function' ? options.sunOf : () => RenderWorld.sun;
  const _fr = { x: 0, y: 0, axX: 0, axY: 0, ayX: 0, ayY: 0, R: 1, cs: 0 };
  const T = REACTOR3D_TUNE;
  const debug = { enabled: true, xray: false, structure: true, plasma: true, shadow: true };
  const stats = { instances: 0, drawCalls: 0, burnt: 0, culled: 0, hidden: 0 };
  let clock = 0;

  const shadowMat = createReactorShadowMaterial({ receiverZ: T.receiverZ, strength: T.shadowStrength, ao: T.shadowAo });
  const kinds = new Map();
  const kindList = [];   // te same rekordy co w `kinds` — pętle na klatkę bez iteratora Map
  for (const kind of REACTOR3D_KINDS) {
    const model = buildReactorModel(kind);
    const data = new Float32Array(REACTOR3D_CAPACITY * STRIDE);
    // Domyślne użycie: WebGPU wysyła zakres po needsUpdate (DynamicDrawUsage
    // w backendzie WebGPU = pełny upload przy każdym renderze).
    const buffer = new THREE.InstancedInterleavedBuffer(data, STRIDE, 1);
    const mkGeo = (base, interleave = true) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = base.index;
      if (interleave) interleaveGeometry(base, g);
      else g.setAttribute('position', base.attributes.position);
      setInstanceLayout(g, buffer);
      g.instanceCount = 0;
      return g;
    };
    const ringsU = [];
    for (let i = 0; i < 2; i++) {
      const r = model.rings[Math.min(i, model.rings.length - 1)];
      ringsU.push(new THREE.Vector4(r.R, r.z, r.ex, r.ey));
    }
    const albedo = model.palette.map(hexToLinear);
    // Graf TSL raz na rodzaj (stałe rodzaju w jego uniformach).
    const structMat = createReactorStructMaterial({
      albedo,
      spec: model.spec.map(([p, k]) => new THREE.Vector2(p, k)),
      ring: ringsU,
      ringCount: model.rings.length,
      coreLight: new THREE.Vector3(model.coreLight?.z ?? 0, model.coreLight?.gain ?? 0, model.coreLight ? 1 : 0),
      accent: model.accent ? hexToLinear(model.accent) : new THREE.Vector3(0, 0, 0),
      accentL: T.accentL,
      ambient: T.ambient,
      lightGain: T.lightGain,
      falloff: T.falloff,
      houseLight: new THREE.Vector3(T.houseAmbient, T.houseDiffuse, T.houseSpecular),
      houseGlow: new THREE.Vector4(T.plasmaBleed, T.crackGlow, T.scorch, 0)
    });
    const coilAng = new Float32Array(MAX_COILS);
    const coilCode = new Float32Array(MAX_COILS);
    for (let k = 0; k < Math.min(MAX_COILS, model.coils.length); k++) {
      coilAng[k] = model.coils[k];
      coilCode[k] = model.coilRing[k];
    }
    const plasmaMat = createReactorPlasmaMaterial({
      coilAng: Array.from(coilAng),
      coilCode: Array.from(coilCode),
      coilCount: Math.min(MAX_COILS, model.coils.length),
      ringDir: [model.rings[0]?.dir ?? 1, model.rings[1]?.dir ?? 1, 1],
      streaks: T.streaks,
      filament: T.filament,
      packet: T.packet,
      flicker: model.flicker || 0,
      coreEdge: CORE_FX_BANDS.coreEdge,
      maxCoils: MAX_COILS
    });
    const quad = receiverQuad();
    const structGeo = mkGeo(model.structure);
    const plasmaGeo = mkGeo(model.plasma);
    const shadowGeo = mkGeo(quad, false);
    const structMesh = new THREE.Mesh(structGeo, structMat);
    const plasmaMesh = new THREE.Mesh(plasmaGeo, plasmaMat);
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    for (const [mesh, order, name] of [[structMesh, STRUCT_RENDER_ORDER, 'structure'], [plasmaMesh, PLASMA_RENDER_ORDER, 'plasma'],
      [shadowMesh, SHADOW_RENDER_ORDER, 'shadow']]) {
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = order;
      mesh.visible = false;
      mesh.layers.set(layer);
      mesh.name = `reactor3D:${kind}:${name}`;
      scene.add(mesh);
    }
    const housing = model.housing;
    const kd = {
      kind, model, data, buffer, structGeo, plasmaGeo, shadowGeo, quad, structMat, plasmaMat, structMesh, plasmaMesh, shadowMesh,
      housing, n: 0
    };
    kinds.set(kind, kd);
    kindList.push(kd);
  }

  // Rekord na rdzeń: rodzaj, ziarno, fazy, maska sektorów; po wyrzucie/kuli — wrak reaktora.
  const records = new Map();
  const band = { prog: 0, bodyL: 0, coreL: 0, coreR: 0, rim: 0, pulseHz: 0 };
  const colorCache = new WeakMap();
  // początek klatki w scenie (y odwrócone), wspólny dla wszystkich rodzajów
  const origin = { x: 0, y: 0, set: false };
  // klatka: słońce, pudło kadru, skala ekranu
  const frame = { sunX: 0, sunY: 0, sunSet: false, view: null, pxPerUnit: 0 };

  function coreColor(core) {
    let c = colorCache.get(core);
    if (!c) {
      const raw = parseColor(core.color, null) || parseColor(colorFor(core), [0.3, 0.7, 1.0]);
      const Lm = Math.max(1e-3, luminance(raw));
      c = [raw[0] / Lm, raw[1] / Lm, raw[2] / Lm];
      colorCache.set(core, c);
    }
    return c;
  }

  function recordFor(core) {
    let rec = records.get(core);
    if (!rec) {
      const k = kindFor(core);
      rec = {
        core, host: core.host, kind: kinds.has(k) ? k : 'terran',
        // RW-20: wizualia renderu — strumień renderu fxRandom (nie Math.random gry).
        seed: ((Math.imul(uidHash(core.uid) + 1, 2654435761) >>> 0) % 1000) / 1000 + fxRandom.next() * 0.001,
        flowPhase: fxRandom.next(), pulsePhase: fxRandom.next() * Math.PI * 2,
        burnt: null, lastSeen: clock,
        maskSig: -1, mask: 0
      };
      records.set(core, rec);
    }
    return rec;
  }

  /**
   * Maska zdjętych sektorów pokrywy z komórek komory (0 — żywa u gospodarza): komórka nad obudową zdejmuje
   * sektory, których środek płyty leży w jej kwadracie (z zapasem), i czapę nad środkiem; komórka poza obudową
   * — sektor od swojej strony (uszkodzenie przyszło stamtąd). Liczona tylko przy zmianie liczników komory.
   */
  function housingMask(rec, core, scale, cs) {
    const dead = core.deadCount | 0, away = core.elsewhereCount | 0;
    const sig = dead + away * 4096 + (core.aliveCount | 0) * 16777216;
    if (sig === rec.maskSig && rec.maskScale === scale) return rec.mask;
    rec.maskSig = sig;
    rec.maskScale = scale;
    let mask = 0;
    const st = core.cellState, cx = core.cellX, cy = core.cellY;
    const n = st && cx && cy ? Math.min(st.length, cx.length, cy.length) : 0;
    if (dead + away > 0 && n > 0) {
      const c = cs > 0 ? cs : 15;
      const h = (c * 0.5) / scale;
      const gx = Number(core.gx) || 0, gy = Number(core.gy) || 0;
      for (let k = 0; k < n; k++) {
        if (st[k] === 0) continue;
        // środek komórki w układzie modelu (x ku dziobowi, y w dół obrazu = −Y ciała)
        const mx = ((cx[k] + 0.5) * c - gx) / scale;
        const my = -((cy[k] + 0.5) * c - gy) / scale;
        let hit = false;
        if (Math.abs(mx) <= h + 0.2 && Math.abs(my) <= h + 0.2) { mask |= 1 << REACTOR3D_HUB_SECTOR; hit = true; }
        for (let s = 0; s < 8; s++) {
          const a = s * Math.PI / 4;
          if (Math.abs(Math.cos(a) * 0.75 - mx) <= h + 0.22 && Math.abs(Math.sin(a) * 0.75 - my) <= h + 0.22) { mask |= 1 << s; hit = true; }
        }
        if (!hit) mask |= 1 << reactorHousingSector(Math.atan2(my, mx));
      }
    }
    rec.mask = mask;
    return mask;
  }

  // Detonacja: wyrzut i kula zostawiają wrak reaktora (kierunek w siatce),
  // pozostałe warianty wyparowują model. `info.host` — obiekt, który niesie
  // kadłub po wybuchu, gdy nie jest nim core.host (gra: zabity NPC oddaje ciało
  // wrakowi; wrak żyje na komórkach rodzica, więc rama rdzenia (frameOf) dalej pasuje).
  function detonated(core, info = {}) {
    const rec = records.get(core) || (core ? recordFor(core) : null);
    if (!rec) return;
    const v = info.variant;
    if (v !== 'jet' && v !== 'orb') { records.delete(core); return; }
    const dx = Number(info.dirGridX) || 0;
    const dy = Number(info.dirGridY) || 0;
    rec.burnt = {
      t0: clock, variant: v,
      dirX: dx, dirY: dy,
      halfWidth: v === 'jet' && (dx || dy) ? 0.42 : 0,
      plasma0: 1
    };
    rec.host = info.host || core.host;
  }

  // Kadłub wraku reaktora zniknął: martwy (gra: zabity NPC, `recycleWreck`).
  // Zimny wrak (bez ciała) nie jest zniknięciem — rekord czeka na odmrożenie.
  function burntHostGone(host) {
    return !host || host.dead === true;
  }

  // Wrak reaktora przechodzi na inny obiekt kadłuba (np. wrak utworzony po
  // detonacji). false = rdzeń nie ma wraku reaktora.
  function rehost(core, host) {
    const rec = records.get(core);
    if (!rec?.burnt || !host) return false;
    rec.host = host;
    return true;
  }

  /**
   * Instancja rdzenia: rama, skala, kadr i widoczność. false — bez instancji (poza kadrem, za mała, ukryta,
   * pełny rodzaj), inaczej offset w danych rodzaju.
   */
  function writeInstance(kd, rec, core) {
    if (kd.n >= REACTOR3D_CAPACITY) return false;
    // Rdzeń na kadłubie belkowym: rama z logiki rdzenia (środek + promień komory w osiach sprite'a).
    frameOf(core, _fr);
    const ax = Math.sqrt(_fr.axX * _fr.axX + _fr.axY * _fr.axY) || 1;
    const ay = Math.sqrt(_fr.ayX * _fr.ayX + _fr.ayY * _fr.ayY) || 1;
    const scale = reactorModelScale(core, rec.kind, Number.isFinite(_fr.R) ? _fr.R : Math.sqrt(ax * ay));
    const H = kd.housing;
    const reach = scale * (H.outer + 1.6);
    const v = frame.view;
    if (v && !debug.xray && (Math.abs(_fr.x - v.x) > v.halfW + reach || Math.abs(_fr.y - v.y) > v.halfH + reach)) {
      stats.culled++;
      return false;
    }
    if (frame.pxPerUnit > 0 && !debug.xray && scale * H.outer * frame.pxPerUnit < T.minPx) { stats.culled++; return false; }
    if (visibility && !debug.xray && !(visibility(core, _fr.x, _fr.y) >= T.visMin)) { stats.hidden++; return false; }
    const b = kd.n * STRIDE;
    const A = kd.data;
    const uxX = _fr.axX / ax, uxY = _fr.axY / ax, uyX = _fr.ayX / ay, uyY = _fr.ayY / ay;
    // scena: y odwrócone
    A[b + L.iBasis] = uxX * scale; A[b + L.iBasis + 1] = -uxY * scale;
    A[b + L.iBasis + 2] = uyX * scale; A[b + L.iBasis + 3] = -uyY * scale;
    if (!origin.set) { origin.x = _fr.x; origin.y = -_fr.y; origin.set = true; }
    const unitZ = scale * T.zScale;
    A[b + L.iPos] = _fr.x - origin.x; A[b + L.iPos + 1] = -_fr.y - origin.y;
    // z modelu 0 (dach wnętrza) = pokład + podłoga modelu + wysokość wnętrza; w prześwietleniu wyżej
    A[b + L.iPos + 2] = T.zBase + unitZ + (debug.xray ? 3 : 0); A[b + L.iPos + 3] = unitZ;
    const col = coreColor(core);
    A[b + L.iColor] = col[0]; A[b + L.iColor + 1] = col[1]; A[b + L.iColor + 2] = col[2]; A[b + L.iColor + 3] = rec.seed;
    // obudowa: maska sektorów, wariant, słońce w układzie modelu (x — dziób, y — w dół obrazu; świat gry ma y w dół)
    let sx = frame.sunX - _fr.x, sy = frame.sunY - _fr.y;
    if (!frame.sunSet) { sx = -0.6; sy = -0.8; }
    const sl = Math.sqrt(sx * sx + sy * sy) || 1;
    sx /= sl; sy /= sl;
    const housingOn = core?.model?.housing === false ? 0 : 1;
    A[b + L.iHouse] = housingMask(rec, core, scale, Number(_fr.cs) || 0);
    A[b + L.iHouse + 1] = housingOn;
    A[b + L.iHouse + 2] = sx * uxX + sy * uxY;
    A[b + L.iHouse + 3] = sx * uyX + sy * uyY;
    const top = housingOn ? H.top : 0;
    A[b + L.iHouse2 + 2] = ((top + 1) * T.zScale + T.zBase / scale) / Math.tan(Math.max(5, T.shadowElevDeg) * DEG);
    A[b + L.iHouse2 + 3] = housingOn ? H.outer : 1;
    kd.n++;
    return b;
  }

  // matrixAutoUpdate = false, a scena Core3D ma jeden sync macierzy na
  // klatkę — macierz świata odświeżana od razu, niezależnie od kolejności.
  function placeAtOrigin(mesh) {
    mesh.position.set(origin.x, origin.y, 0);
    mesh.updateMatrix();
    mesh.updateMatrixWorld();
  }

  /**
   * @param cores   rdzenie (shipCores wszystkich kadłubów; z list widocznych — mgła wojny)
   * @param nowSec  czas (nieużywany — model kroczy simDt)
   * @param simDt   krok symulacji tej klatki (pauza = 0)
   * @param opts    { sceneOrigin: { x, y } } — początek przy kamerze w układzie
   *                SCENY (x, −y świata), np. wynik sceneOriginNearCamera
   *                (src/3d/sceneOrigin.js) — tak w grze; albo { origin: { x, y } }
   *                w układzie świata gry (y w dół). Bez obu — pierwszy widoczny rdzeń.
   *                view: { x, y, drawHalfW, drawHalfH } (albo halfW / halfH) — kadr w świecie gry (bez — bez
   *                cullingu); zoom — zoom kamery gry (px na j. ≈ zoom × DPR; bez — bez progu minPx) albo
   *                pxPerUnit wprost.
   */
  function sync(cores, nowSec, simDt = 1 / 60, opts = null) {
    const dt = Math.max(0, Number(simDt) || 0);
    clock += dt;
    for (let k = 0; k < kindList.length; k++) kindList[k].n = 0;
    const so = opts?.sceneOrigin;
    const o = opts?.origin;
    if (so && Number.isFinite(so.x) && Number.isFinite(so.y)) {
      origin.x = so.x; origin.y = so.y; origin.set = true;
    } else {
      origin.set = !!o && Number.isFinite(o.x) && Number.isFinite(o.y);
      if (origin.set) { origin.x = o.x; origin.y = -o.y; }
    }
    const view = opts?.view;
    if (view && Number.isFinite(view.x) && Number.isFinite(view.y)) {
      const hw = Number(view.drawHalfW ?? view.halfW), hh = Number(view.drawHalfH ?? view.halfH);
      frame.view = hw > 0 && hh > 0 ? (frame._v || (frame._v = { x: 0, y: 0, halfW: 0, halfH: 0 })) : null;
      if (frame.view) { frame.view.x = view.x; frame.view.y = view.y; frame.view.halfW = hw; frame.view.halfH = hh; }
    } else frame.view = null;
    const zoom = Number(opts?.zoom);
    frame.pxPerUnit = Number(opts?.pxPerUnit) > 0 ? Number(opts.pxPerUnit)
      : (zoom > 0 ? zoom * (Number(RenderWorld.devicePixelRatio) || 1) : 0);
    const sun = sunOf();
    frame.sunSet = !!sun && Number.isFinite(sun.x) && Number.isFinite(sun.y);
    if (frame.sunSet) { frame.sunX = sun.x; frame.sunY = sun.y; }
    stats.culled = 0;
    stats.hidden = 0;
    let visible = 0;
    let burntN = 0;
    if (debug.enabled) {
      const list = Array.isArray(cores) ? cores : [];
      for (const core of list) {
        if (!core || core.invalid || core.state === CORE_STATE.DETONATED) continue;
        const host = core.host;
        if (!hostReady(host)) continue;
        const rec = recordFor(core);
        rec.lastSeen = clock;
        rec.host = host;
        const kd = kinds.get(rec.kind);
        coreStateBand(core, band);
        rec.flowPhase += flowRevPerSec(core, band) * dt;
        rec.pulsePhase += Math.PI * 2 * band.pulseHz * dt;
        const pulse = 0.5 + 0.5 * Math.sin(rec.pulsePhase);
        const b = writeInstance(kd, rec, core);
        if (b === false) continue;
        const A = kd.data;
        const heat = coilHeat(core, band);
        A[b + L.iState] = band.bodyL; A[b + L.iState + 1] = band.coreL * (0.92 + 0.08 * pulse);
        A[b + L.iState + 2] = rec.flowPhase; A[b + L.iState + 3] = instability(core, band);
        A[b + L.iState2] = heat; A[b + L.iState2 + 1] = brokenFrac(core);
        A[b + L.iState2 + 2] = pulse; A[b + L.iState2 + 3] = 1;
        A[b + L.iBreak] = 0; A[b + L.iBreak + 1] = 0; A[b + L.iBreak + 2] = 0; A[b + L.iBreak + 3] = -1;
        A[b + L.iHouse2] = band.rim; A[b + L.iHouse2 + 1] = heat;
        visible++;
      }
      // wraki reaktorów (po wyrzucie i kuli); zimny wrak (bez ciała) nie
      // rysuje, ale rekord czeka na odmrożenie
      for (const rec of records.values()) {
        if (!rec.burnt) continue;
        const host = rec.host;
        if (!hostReady(host) || burntHostGone(host)) continue;
        const kd = kinds.get(rec.kind);
        const t = clock - rec.burnt.t0;
        const core = rec.core;
        const b = writeInstance(kd, rec, core);
        if (b === false) continue;
        const heat = Math.exp(-t / Math.max(0.05, T.burnCool));
        const plasma = Math.max(0, 1 - t / Math.max(0.01, T.plasmaOut));
        rec.flowPhase += 2.5 * dt * plasma;
        const A = kd.data;
        A[b + L.iState] = CORE_FX_BANDS.bodyL.meltdown; A[b + L.iState + 1] = CORE_FX_BANDS.coreL.meltdown * plasma;
        A[b + L.iState + 2] = rec.flowPhase; A[b + L.iState + 3] = 0.9;
        A[b + L.iState2] = heat; A[b + L.iState2 + 1] = 0.85; A[b + L.iState2 + 2] = 0.5; A[b + L.iState2 + 3] = plasma;
        A[b + L.iBreak] = rec.burnt.dirX; A[b + L.iBreak + 1] = rec.burnt.dirY;
        A[b + L.iBreak + 2] = rec.burnt.halfWidth; A[b + L.iBreak + 3] = heat;
        // wrak: pokrywa zerwana cała (czapa i sektory), zostaje ściana z poszarpanym brzegiem
        A[b + L.iHouse] = 511;
        A[b + L.iHouse2] = CORE_FX_BANDS.rimHeat.meltdownEnd * heat; A[b + L.iHouse2 + 1] = 0.85 * heat;
        visible++;
        burntN++;
      }
    }
    // rekordy rdzeni, których nie widać od dawna (kadłub zniknął)
    for (const [core, rec] of records) {
      if (rec.burnt) { if (burntHostGone(rec.host)) records.delete(core); continue; }
      if (clock - rec.lastSeen > 30) records.delete(core);
    }
    let calls = 0;
    for (let k = 0; k < kindList.length; k++) {
      const kd = kindList[k];
      const n = kd.n;
      kd.structGeo.instanceCount = n;
      kd.plasmaGeo.instanceCount = n;
      kd.shadowGeo.instanceCount = n;
      kd.structMesh.visible = n > 0 && debug.structure;
      kd.plasmaMesh.visible = n > 0 && debug.plasma;
      kd.shadowMesh.visible = n > 0 && debug.shadow && T.shadow && debug.structure && !debug.xray;
      if (n > 0) {
        commitBuffer(kd.buffer, n);
        placeAtOrigin(kd.structMesh);
        placeAtOrigin(kd.plasmaMesh);
        placeAtOrigin(kd.shadowMesh);
      }
      kd.structMat.uniforms.uTime.value = clock;
      kd.plasmaMat.uniforms.uTime.value = clock;
      kd.structMat.uniforms.uXray.value = debug.xray ? 1 : 0;
      calls += (kd.structMesh.visible ? 1 : 0) + (kd.plasmaMesh.visible ? 1 : 0) + (kd.shadowMesh.visible ? 1 : 0);
    }
    stats.instances = visible;
    stats.burnt = burntN;
    stats.drawCalls = calls;
    if (markLayerActive && calls > 0 && layer !== 0) markLayerActive();
    return calls;
  }

  function reset() {
    records.clear();
  }

  // Siatki do rozgrzewki (Core3D.warmup): konstrukcja, plazma i cień każdego rodzaju.
  function warmupMeshes() {
    const out = [];
    for (const kd of kindList) out.push(kd.structMesh, kd.plasmaMesh, kd.shadowMesh);
    return out;
  }

  function dispose() {
    for (const kd of kinds.values()) {
      scene.remove(kd.structMesh);
      scene.remove(kd.plasmaMesh);
      scene.remove(kd.shadowMesh);
      kd.structGeo.dispose(); kd.plasmaGeo.dispose(); kd.shadowGeo.dispose(); kd.quad.dispose();
      kd.model.structure.dispose(); kd.model.plasma.dispose();
      kd.structMat.dispose(); kd.plasmaMat.dispose();
    }
    shadowMat.dispose();
    kinds.clear();
    kindList.length = 0;
    records.clear();
  }

  return {
    sync, detonated, rehost, reset, dispose, warmupMeshes, stats, debug, layer, origin,
    kinds: [...kinds.keys()],
    meshes: Object.fromEntries([...kinds.values()].map((kd) => [kd.kind, { structure: kd.structMesh, plasma: kd.plasmaMesh, shadow: kd.shadowMesh }])),
    /** Dane instancji `i` rodzaju `kind`: { iBasis: [4], iPos: [4], … } (testy, narzędzia). */
    instance(kind, i = 0) {
      const kd = kinds.get(kind);
      if (!kd) return null;
      const out = {};
      for (const [name, off] of Object.entries(L)) {
        if (name === 'stride') continue;
        out[name] = Array.from(kd.data.subarray(i * STRIDE + off, i * STRIDE + off + 4));
      }
      return out;
    },
    records
  };
}
