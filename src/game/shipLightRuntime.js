import {
  LIGHT_DEFAULTS,
  LIGHT_KINDS,
  normalizeLightsBlock
} from '../ui/shipLightEditorModel.js';
// Maskowanie (2026-10-04): lampy gasną z komórką kadłuba pod sobą, reflektory i rozlew lamp z resztą okrętu.
import { cloakLightGain, entityCloakVisAt } from './cloakLook.js';
// Rozpad kadłuba belkowego (2026-10-05): lampa gaśnie, gdy komórka pod nią nie jest już żywym węzłem ciała
// właściciela (odcięta z odłamem albo zestrzelona) — hullMounts.js.
import {
  beginHullMountBind,
  bindHullMount,
  createHullMountSet,
  mountHullOf,
  refreshHullMountSet
} from './hullMounts.js';

// 64, nie 32: Atlas ma 42 lampy pozycyjne + 2 reflektory + 5 reflektorów
// otoczenia; przy 32 reflektory wypadały z shadera kadłuba (lampy pozycyjne
// szły pierwsze). Tablice 3 × 64 vec4 mieszczą się w limicie fragmentu
// (ANGLE/D3D11: 1024 vec4).
export const MAX_SHADER_SHIP_LIGHTS = 64;
export const MAX_EXTERNAL_ROAD_SHADER_LIGHTS = 8;
// Grupy lamp pozycyjnych innych statków w payloadzie kadłuba (rozlew czerwieni).
export const MAX_EXTERNAL_OMNI_SHADER_LIGHTS = 4;
export const MAX_NAV_LIGHT_SPRITES = 512;

// Reflektory otoczenia generowane z obrysu lamp, gdy kadłub nie ma własnych
// (brak lamp `flood` i reflektorów `road` skierowanych w bok lub do tyłu).
// Progi w j. świata długości kadłuba: rufa od małych okrętów, jedna para burt
// dla średnich, dwie pary dla dużych (user 2026-09-26: „jeden reflektor na
// tyle, po dwa na każdy bok (na duże statki)”).
export const AUTO_FLOOD = Object.freeze({
  rearMinLen: 150,
  midMinLen: 250,
  pairMinLen: 600,
  pairAt: Object.freeze([0.3, 0.68]),   // położenie par wzdłuż kadłuba (od rufy)
  midAt: 0.5,
  inboard: 0.88,                        // lampa tuż wewnątrz obrysu lamp pozycyjnych
  // Zasięg stożka (px sprite'a) = ułamek długości: sięga kadłuba okrętu obok
  // w szyku (~1000 j. u Atlasa, jak światło pola). Na własnym pancerzu stożka
  // nie ma (hexShips3D) — tylko lampa.
  rangeFrac: 0.6
});

// Grupy lamp pozycyjnych (do 4 na statek: burta × połowa długości) — jedno
// światło zamiast kilkudziesięciu lamp przy oświetlaniu skał i innych statków.
export const NAV_CLUSTER = Object.freeze({
  maxGroups: 4,
  reachWorld: 260,       // zasięg rozlewu poza rozrzutem grupy [j. świata]
  meanSequence: 0.44     // średnia mnożnika sekwencji w cyklu (rest + błysk)
});
const EPSILON = 1e-6;
const LIGHT_KIND_LIST = Object.values(LIGHT_KINDS);

// Podpis payloadu świateł jako liczba (FNV-1a 32-bit), nie `join('|')` —
// podpis liczy się dla każdej encji w każdej klatce, a string na ~300 części
// (Atlas: 22 lampy) był jednym z głównych kosztów „U hex”. Liczby mieszamy po
// bitach Float64 (bez alokacji), stringi po kodach znaków. Kolizje są pomijalne:
// podpis porównujemy tylko z poprzednim podpisem tej samej encji.
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const _hashF64 = new Float64Array(1);
const _hashU32 = new Uint32Array(_hashF64.buffer);

function hashMixNumber(hash, value) {
  _hashF64[0] = Number(value);
  hash = Math.imul(hash ^ _hashU32[0], FNV_PRIME);
  return Math.imul(hash ^ _hashU32[1], FNV_PRIME);
}

function hashMixString(hash, value) {
  const str = typeof value === 'string' ? value : String(value ?? '');
  hash = Math.imul(hash ^ str.length, FNV_PRIME);
  for (let i = 0; i < str.length; i++) hash = Math.imul(hash ^ str.charCodeAt(i), FNV_PRIME);
  return hash;
}

// Znacznik sekcji świateł zewnętrznych w podpisie (dawne 'external' w join).
const HASH_EXTERNAL_SECTION = 0x45585452;

// Wspólne parametry sekwencji świateł pozycyjnych ("pas startowy").
// Z tych wartości korzystają DWA shadery: pętla lamp w kadłubie (hexShips3D)
// i billboardy blasku (shipLights3D) — muszą pulsować w idealnej synchronizacji,
// więc stałe wolno zmieniać wyłącznie tutaj. Faza świateł rośnie w stronę
// dziobu (+X sprite'a), a chase = fract(t*speed + phase*gain) przesuwa aktywny
// błysk od dziobu ku rufie (dziób w prawo => "od prawej do lewej").
export const NAV_LIGHT_CHASE = Object.freeze({
  speed: 0.42,      // pełne przebiegi sekwencji na sekundę
  phaseGain: 0.95,  // jaka część cyklu rozciąga się wzdłuż kadłuba
  attack: 0.10,     // narastanie błysku (fraction cyklu)
  hold: 0.18,       // początek wygaszania
  release: 0.42,    // koniec wygaszania
  rest: 0.25        // poświata lampy pomiędzy błyskami (mnożnik)
});

// Literał GLSL z gwarantowaną kropką dziesiętną (1 -> "1.0000").
export function glslFloat(value, fallback = 0) {
  const num = Number(value);
  return (Number.isFinite(num) ? num : fallback).toFixed(4);
}

function round2(value) {
  const num = Number(value) || 0;
  const sign = num < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(num) * 100) / 100;
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function clampLightLimit(value, fallback = MAX_SHADER_SHIP_LIGHTS) {
  const num = Number(value);
  const limit = Number.isFinite(num) ? num : fallback;
  return Math.max(0, Math.min(MAX_SHADER_SHIP_LIGHTS, Math.floor(limit)));
}

function normalizeDeg(value, fallback = 0) {
  let deg = Number.isFinite(Number(value)) ? Number(value) : Number(fallback) || 0;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

function expandHex(value, fallback = '#ffffff') {
  const raw = String(value || fallback || '#ffffff').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return expandHex(fallback, '#ffffff');
}

export function hexToRgb01(value, fallback = '#ffffff') {
  const hex = expandHex(value, fallback);
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255
  };
}

// Barwa lampy z napisu w gorących pętlach klatki (emitery reflektorów, sprite'y lamp): ten sam wynik co
// hexToRgb01, z pamięci po (napis, zapas) — parsowanie (trim, regex, slice, parseInt) i nowy obiekt szły co klatkę
// na każdą lampę w kadrze. Obiekt barwy wspólny — konsumenci (shader kadłuba, siatka świateł, billboardy)
// tylko go czytają.
const _rgbByFallback = new Map();
function cachedRgb01(value, fallback) {
  if (typeof value !== 'string') return hexToRgb01(value, fallback);
  let byValue = _rgbByFallback.get(fallback);
  if (byValue === undefined) { byValue = new Map(); _rgbByFallback.set(fallback, byValue); }
  let rgb = byValue.get(value);
  if (rgb === undefined) {
    if (byValue.size >= 4096) byValue.clear();
    rgb = hexToRgb01(value, fallback);
    byValue.set(value, rgb);
  }
  return rgb;
}

export function getEntityLightScale(entity) {
  const scaleXRaw = Number(entity?.__hardpointScaleX);
  const scaleYRaw = Number(entity?.__hardpointScaleY);
  const uniformRaw = Number(entity?.__hardpointScale);
  const uniform = Number.isFinite(uniformRaw) && uniformRaw > 0 ? uniformRaw : 1;
  const scaleX = Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : uniform;
  const scaleY = Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : uniform;
  return {
    x: scaleX,
    y: scaleY,
    uniform: (scaleX + scaleY) * 0.5
  };
}

function getEntityLightSource(entity) {
  return entity?.editorLights || entity?.visual?.lights || entity?.capitalProfile?.lights || entity?.profile?.lights;
}

// Znormalizowany blok lamp per obiekt źródłowy. getEntityLights leci 2–3 razy
// per encja per klatkę (emitery, billboardy, payload shadera), a normalizacja
// budowała blok, tablice i obiekt na każdy marker. Źródła (`editorLights`
// z npcHardpointRuntime / shipBridge / index.html) są podmieniane całościowo,
// nigdy edytowane w miejscu, więc nowe źródło = nowy klucz = nowa normalizacja.
// Wynik jest tylko do odczytu (wspólny dla wszystkich wywołań).
const normalizedLightsCache = new WeakMap();
const EMPTY_LIGHTS_BLOCK = Object.freeze({
  [LIGHT_KINDS.POSITION]: Object.freeze([]),
  [LIGHT_KINDS.ROAD]: Object.freeze([]),
  [LIGHT_KINDS.FLOOD]: Object.freeze([]),
  hullLenPx: 0
});

export function getEntityLights(entity) {
  const source = getEntityLightSource(entity);
  if (!source || typeof source !== 'object') return EMPTY_LIGHTS_BLOCK;
  let block = normalizedLightsCache.get(source);
  if (block === undefined) {
    block = normalizeLightsBlock(source);
    // `autoFlood: false` — źródło celowo bez reflektorów otoczenia (hulk po
    // utracie dowodzenia): bez tego zgaszone lampy dostałyby automatyczne.
    addAutoFloodMarkers(block, source.autoFlood !== false);
    normalizedLightsCache.set(source, block);
  }
  // Kadłub belkowy: bez lamp, których komórka nie jest już żywym węzłem ciała encji (liveLightsBlock).
  block = liveLightsBlock(entity, block);
  // Reflektory wyłączone (`entity.roadLightsOff`, klawisz L gracza): ten sam blok bez
  // lamp `road` i `flood` — pozycyjne i długość obrysu zostają. Wariant w cache per źródło.
  if (entity.roadLightsOff) {
    let dark = darkLightsCache.get(block);
    if (dark === undefined) {
      dark = {
        [LIGHT_KINDS.POSITION]: block[LIGHT_KINDS.POSITION],
        [LIGHT_KINDS.ROAD]: EMPTY_LIGHTS_BLOCK[LIGHT_KINDS.ROAD],
        [LIGHT_KINDS.FLOOD]: EMPTY_LIGHTS_BLOCK[LIGHT_KINDS.FLOOD],
        hullLenPx: block.hullLenPx
      };
      darkLightsCache.set(block, dark);
    }
    return dark;
  }
  return block;
}
const darkLightsCache = new WeakMap();

// Lampy na kadłubie belkowym (hullBodies.js) leżą w pikselach sprite'a właściciela. Po rozpadzie lampy odpadłej
// części zostawały na rodzicu w tym samym miejscu sprite'a: nad dryfującym wrakiem, potem w pustce — i dalej
// świeciły na skały i inne okręty. Każda lampa bloku (także automatyczne reflektory otoczenia) ma komórkę siatki
// belek (hullMounts.js); blok encji = lampy, których komórka jest żywym węzłem jej BIEŻĄCEGO ciała. Wiązanie
// raz na blok (agonia hulka podmienia źródło — nowy blok, nowe wiązanie po siatce spoczynkowej, więc zgaszona
// lampa nie wraca), żywotność tylko przy zmianie ciała; ten sam stan = ten sam obiekt bloku (cache payloadu
// kadłuba i grup lamp trzymają się tożsamości). Długość obrysu (`hullLenPx`, progi reflektorów) zostaje z bloku.
const liveLightsCache = new WeakMap();
const LIGHT_KIND_ORDER = [LIGHT_KINDS.POSITION, LIGHT_KINDS.ROAD, LIGHT_KINDS.FLOOD];

// Skale hardpointów jak getEntityLightScale, bez obiektu (getEntityLights idzie kilka razy na encję na klatkę).
function lightScaleX(entity) {
  const raw = Number(entity.__hardpointScaleX);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const u = Number(entity.__hardpointScale);
  return Number.isFinite(u) && u > 0 ? u : 1;
}

function lightScaleY(entity) {
  const raw = Number(entity.__hardpointScaleY);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const u = Number(entity.__hardpointScale);
  return Number.isFinite(u) && u > 0 ? u : 1;
}

function liveLightsBlock(entity, block) {
  const hull = mountHullOf(entity);
  if (!hull) return block;
  let rec = liveLightsCache.get(entity);
  if (rec === undefined) {
    rec = { block: null, hsx: 0, hsy: 0, set: createHullMountSet(), version: -1, filtered: block };
    liveLightsCache.set(entity, rec);
  }
  const set = rec.set;
  const hsx = lightScaleX(entity), hsy = lightScaleY(entity);
  if (rec.block !== block || set.lineage !== hull.dmgKey || rec.hsx !== hsx || rec.hsy !== hsy) {
    let n = 0;
    for (let k = 0; k < LIGHT_KIND_ORDER.length; k++) n += block[LIGHT_KIND_ORDER[k]].length;
    const rest = beginHullMountBind(set, hull, n);
    let at = 0;
    for (let k = 0; k < LIGHT_KIND_ORDER.length; k++) {
      const list = block[LIGHT_KIND_ORDER[k]];
      for (let i = 0; i < list.length; i++) {
        set.cells[at++] = bindHullMount(hull, (Number(list[i].x) || 0) * hsx, (Number(list[i].y) || 0) * hsy, rest);
      }
    }
    rec.block = block;
    rec.hsx = hsx;
    rec.hsy = hsy;
  }
  refreshHullMountSet(set, hull);
  if (rec.version !== set.version) {
    rec.version = set.version;
    rec.filtered = set.dead === 0 ? block : filterLightsBlock(block, set.alive);
  }
  return rec.filtered;
}

// Blok z samymi żywymi lampami (kolejność rodzajów jak przy wiązaniu). Markery wspólne z blokiem źródłowym.
function filterLightsBlock(block, alive) {
  const out = { hullLenPx: block.hullLenPx };
  let at = 0;
  for (let k = 0; k < LIGHT_KIND_ORDER.length; k++) {
    const kind = LIGHT_KIND_ORDER[k];
    const list = block[kind];
    const kept = [];
    for (let i = 0; i < list.length; i++) if (alive[at++]) kept.push(list[i]);
    out[kind] = kept;
  }
  return out;
}

/**
 * Ile WŁASNYCH reflektorów dalekich ma okręt (znaczniki `road` w źródle lamp) — także zgaszonych: komórka
 * kadłuba pod lampą martwa albo odcięta odłamem (liveLightsBlock), agonia hulka (shipBridge.js: pierwotne lampy
 * w `bridgeState.navOriginal`). Światło pola (lightGrid.addShipLights) daje zastępczą parę na dziobie tylko
 * okrętom bez własnych (0) — zgaszone nie wracają jako zastępcze — i dzieli moc przez liczbę z układu, nie
 * przez żywe (lampa nie jaśnieje, gdy sąsiednia zgaśnie).
 */
export function entityOwnRoadLightCount(entity) {
  const source = getEntityLightSource(entity);
  const n = source && typeof source === 'object' && Array.isArray(source.road) ? source.road.length : 0;
  const orig = entity?.bridgeState?.navOriginal;
  const m = orig && Array.isArray(orig.road) ? orig.road.length : 0;
  return n > m ? n : m;
}

// Obrys kadłuba z lamp (px sprite'a, +X = dziób): pozycyjne leżą na krawędzi.
function lightsOutline(block) {
  const pts = [];
  for (const kind of [LIGHT_KINDS.POSITION, LIGHT_KINDS.ROAD, LIGHT_KINDS.FLOOD]) {
    const list = block[kind];
    if (Array.isArray(list)) for (const m of list) pts.push(m);
  }
  let xMin = Infinity;
  let xMax = -Infinity;
  for (const p of pts) {
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
  }
  return { pts, xMin, xMax, len: xMax - xMin };
}

/**
 * Reflektory otoczenia z obrysu lamp: rufa + burty (pary zależnie od długości
 * kadłuba, filtr per encja w floodLightAllowed). Tylko gdy kadłub nie ma
 * własnych: lamp `flood` ani reflektorów `road` w bok/do tyłu (|deg − 90| > 50).
 * Markery mają `auto: true` i progi długości. Blok znormalizowany
 * (normalizeLightsBlock); edytor pokazuje z tego podgląd i „wstaw domyślne”.
 * @returns {{ hullLenPx: number, markers: object[] }}
 */
export function computeAutoFloodMarkers(block) {
  const outline = lightsOutline(block);
  const hullLenPx = Number.isFinite(outline.len) && outline.len > 0 ? outline.len : 0;
  const out = [];
  const result = { hullLenPx, markers: out };
  if (block[LIGHT_KINDS.FLOOD].length) return result;
  for (const r of block[LIGHT_KINDS.ROAD]) {
    let d = Math.abs((Number(r.deg) || 0) - 90);
    if (d > 180) d = 360 - d;
    if (d > 50) return result;
  }
  const { pts, xMin, len } = outline;
  if (pts.length < 4 || !(len > 0)) return result;
  const edgeAt = (x0, side) => {
    let best = 0;
    let any = 0;
    for (const p of pts) {
      if (side * p.y <= len * 0.02) continue;
      any = Math.max(any, Math.abs(p.y));
      if (Math.abs(p.x - x0) <= len * 0.2 && Math.abs(p.y) > best) best = Math.abs(p.y);
    }
    return best > 0 ? best : (any > 0 ? any * 0.75 : len * 0.18);
  };
  let rearY = 0;
  let rearN = 0;
  for (const p of pts) {
    if (p.x <= xMin + len * 0.1) { rearY += p.y; rearN++; }
  }
  const d = LIGHT_DEFAULTS[LIGHT_KINDS.FLOOD];
  const make = (id, x, y, deg, minLen, maxLen = Infinity) => ({
    id, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, deg,
    color: d.color, power: d.power, radius: d.radius,
    range: Math.round(Math.max(50, Math.min(4000, len * AUTO_FLOOD.rangeFrac))),
    coneDeg: d.coneDeg, auto: true, minLen, maxLen
  });
  out.push(make('auto_flood_rear', xMin + len * 0.02, rearN ? rearY / rearN : 0, -90, AUTO_FLOOD.rearMinLen));
  const sides = (at, tag, minLen, maxLen) => {
    const x = xMin + len * at;
    out.push(make(`auto_flood_${tag}_l`, x, -edgeAt(x, -1) * AUTO_FLOOD.inboard, 0, minLen, maxLen));
    out.push(make(`auto_flood_${tag}_r`, x, edgeAt(x, 1) * AUTO_FLOOD.inboard, 180, minLen, maxLen));
  };
  sides(AUTO_FLOOD.midAt, 'mid', AUTO_FLOOD.midMinLen, AUTO_FLOOD.pairMinLen);
  AUTO_FLOOD.pairAt.forEach((at, i) => sides(at, `pair${i}`, AUTO_FLOOD.pairMinLen));
  return result;
}

// Blok z cache getEntityLights dostaje reflektory z obrysu i długość obrysu.
function addAutoFloodMarkers(block, allowAuto = true) {
  const { hullLenPx, markers } = computeAutoFloodMarkers(block);
  block.hullLenPx = hullLenPx;
  if (!allowAuto) return;
  for (const m of markers) block[LIGHT_KINDS.FLOOD].push(m);
}

/** Długość kadłuba w j. świata z obrysu lamp (skala hardpointu × skala sprite'a). */
export function getEntityHullLengthWorld(entity, block = getEntityLights(entity), options = {}) {
  const lenPx = Number(block?.hullLenPx) || 0;
  if (!(lenPx > 0)) return 0;
  return lenPx * getEntityLightScale(entity).x * getEntitySpriteScale(entity, options).x;
}

/** Czy reflektor świeci na kadłubie tej długości (automatyczne mają progi rozmiaru). */
export function floodLightAllowed(marker, hullLenWorld) {
  if (!marker?.auto) return true;
  return hullLenWorld >= (Number(marker.minLen) || 0) && hullLenWorld < (Number.isFinite(marker.maxLen) ? marker.maxLen : Infinity);
}

// Tani test BEZ normalizacji: czy encja ma choć jeden marker lampy. Wraki,
// asteroidy i większość NPC nie mają żadnych, a pełny payload (normalizacja
// bloku + tablice + podpis-string) szedł dla nich co klatkę.
export function hasEntityLightSource(entity) {
  const source = getEntityLightSource(entity);
  if (!source || typeof source !== 'object') return false;
  for (let i = 0; i < LIGHT_KIND_LIST.length; i++) {
    const markers = source[LIGHT_KIND_LIST[i]];
    if (Array.isArray(markers) && markers.length > 0) return true;
  }
  return false;
}

function lightDirection(deg) {
  const rad = normalizeDeg(deg, 90) * Math.PI / 180;
  const x = Math.sin(rad);
  const y = -Math.cos(rad);
  return {
    x: Math.abs(x) < 1e-12 ? 0 : round2(x),
    y: Math.abs(y) < 1e-12 ? 0 : round2(y)
  };
}

function directionalScale(dir, scale) {
  const sx = Number(scale?.x) || 1;
  const sy = Number(scale?.y) || 1;
  const dx = (Number(dir?.x) || 0) * sx;
  const dy = (Number(dir?.y) || 0) * sy;
  const len = Math.hypot(dx, dy);
  return Number.isFinite(len) && len > 0 ? len : (Number(scale?.uniform) || 1);
}

function getScaledLightLocal(marker, scale) {
  const scaleX = Number(scale?.x) || 1;
  const scaleY = Number(scale?.y) || 1;
  return {
    x: (Number(marker?.x) || 0) * scaleX,
    y: (Number(marker?.y) || 0) * scaleY
  };
}

function normalizeVec2(x, y, fallbackX = 1, fallbackY = 0) {
  const len = Math.hypot(Number(x) || 0, Number(y) || 0);
  if (!Number.isFinite(len) || len <= EPSILON) {
    return { x: fallbackX, y: fallbackY };
  }
  return {
    x: round2(x / len),
    y: round2(y / len)
  };
}

function getEntityPosition(entity, options = {}) {
  const custom = typeof options.getPosition === 'function' ? options.getPosition(entity) : null;
  const x = Number(custom?.x);
  const y = Number(custom?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return {
    x: Number.isFinite(Number(entity?.pos?.x)) ? Number(entity.pos.x) : (Number(entity?.x) || 0),
    y: Number.isFinite(Number(entity?.pos?.y)) ? Number(entity.pos.y) : (Number(entity?.y) || 0)
  };
}

function getEntityAngle(entity, options = {}) {
  if (typeof options.getAngle === 'function') {
    const custom = Number(options.getAngle(entity));
    if (Number.isFinite(custom)) return custom;
  }
  return (Number(entity?.angle) || 0) + (Number(entity?.capitalProfile?.spriteRotation) || 0);
}

function getEntitySpriteScale(entity, options = {}) {
  const customX = typeof options.getSpriteScaleX === 'function' ? Number(options.getSpriteScaleX(entity)) : NaN;
  const customY = typeof options.getSpriteScaleY === 'function' ? Number(options.getSpriteScaleY(entity)) : NaN;
  const uniformRaw = Number(entity?.visual?.spriteScale);
  const uniform = Number.isFinite(uniformRaw) && uniformRaw > 0 ? uniformRaw : 1;
  const scaleXRaw = Number(entity?.visual?.spriteScaleX);
  const scaleYRaw = Number(entity?.visual?.spriteScaleY);
  const x = Number.isFinite(customX) && customX > 0
    ? customX
    : (Number.isFinite(scaleXRaw) && scaleXRaw > 0 ? scaleXRaw : uniform);
  const y = Number.isFinite(customY) && customY > 0
    ? customY
    : (Number.isFinite(scaleYRaw) && scaleYRaw > 0 ? scaleYRaw : uniform);
  return {
    x,
    y,
    uniform: (x + y) * 0.5
  };
}

function getEntityRadiusWorld(entity, grid, spriteScale, options = {}) {
  if (typeof options.getRadius === 'function') {
    const custom = Number(options.getRadius(entity));
    if (Number.isFinite(custom) && custom > 0) return custom;
  }
  const raw = Number(entity?.radius ?? entity?.r);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const width = Math.max(1, Number(grid?.srcWidth) || 1) * (Number(spriteScale?.x) || 1);
  const height = Math.max(1, Number(grid?.srcHeight) || 1) * (Number(spriteScale?.y) || 1);
  return Math.max(16, Math.hypot(width, height) * 0.5);
}

function worldToEntitySpritePixels(worldX, worldY, entity, grid, options = {}) {
  const pos = getEntityPosition(entity, options);
  const angle = getEntityAngle(entity, options);
  const spriteScale = getEntitySpriteScale(entity, options);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = (Number(worldX) || 0) - pos.x;
  const dy = (Number(worldY) || 0) - pos.y;
  const localScaledX = dx * c + dy * s;
  const localScaledY = -dx * s + dy * c;
  const localX = localScaledX / Math.max(EPSILON, spriteScale.x);
  const localY = localScaledY / Math.max(EPSILON, spriteScale.y);
  const width = Math.max(1, Number(grid?.srcWidth) || 1);
  const height = Math.max(1, Number(grid?.srcHeight) || 1);
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;
  return {
    x: round2(localX + width * 0.5 + pivotX),
    y: round2(localY + height * 0.5 + pivotY)
  };
}

function worldDirToEntitySpriteDir(dir, entity, options = {}) {
  const angle = getEntityAngle(entity, options);
  const spriteScale = getEntitySpriteScale(entity, options);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const worldX = Number(dir?.x) || 0;
  const worldY = Number(dir?.y) || 0;
  const localScaledX = worldX * c + worldY * s;
  const localScaledY = -worldX * s + worldY * c;
  return normalizeVec2(
    localScaledX / Math.max(EPSILON, spriteScale.x),
    localScaledY / Math.max(EPSILON, spriteScale.y),
    1,
    0
  );
}

function packLight(marker, kind, grid, scale) {
  const width = Math.max(1, Number(grid?.srcWidth) || 1);
  const height = Math.max(1, Number(grid?.srcHeight) || 1);
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;
  const scaleUniform = Number(scale?.uniform) || 1;
  const local = getScaledLightLocal(marker, scale);
  const defaults = LIGHT_DEFAULTS[kind] || LIGHT_DEFAULTS[LIGHT_KINDS.ROAD];
  const directional = kind === LIGHT_KINDS.ROAD || kind === LIGHT_KINDS.FLOOD;
  const color = hexToRgb01(marker?.color, defaults.color);
  const dir = directional ? lightDirection(marker?.deg ?? defaults.deg) : { x: 0, y: -1 };
  const rangeScale = directional ? directionalScale(dir, scale) : scaleUniform;

  return {
    id: marker?.id || '',
    kind,
    pos: {
      x: round2(local.x + width * 0.5 + pivotX),
      y: round2(local.y + height * 0.5 + pivotY)
    },
    color,
    radiusPx: round2(clamp(marker?.radius, 1, 48, defaults.radius) * scaleUniform),
    power: round2(clamp(marker?.power, 0.05, 20, defaults.power)),
    dir,
    rangePx: round2(clamp(marker?.range, 50, 4000, defaults.range ?? 800) * rangeScale),
    coneDeg: round2(clamp(marker?.coneDeg, 8, 160, defaults.coneDeg ?? 40))
  };
}

// Własne lampy kadłuba w przestrzeni sprite'a zależą tylko od bloku lamp (stały
// per źródło — getEntityLights), skali hardpointu, długości kadłuba (progi
// reflektorów otoczenia), limitu i wymiarów siatki — nie od pozy. Pakowanie
// (obiekt + kolor + kierunek na lampę, do 64 lamp) szło w bitwie co klatkę dla
// każdego kadłuba. Cache per encja; wynik to świeży obiekt i świeża tablica,
// ale obiekty lamp są wspólne między wywołaniami — tylko do odczytu.
const ownPayloadCache = new WeakMap();

export function buildShipLightShaderPayload(entity, grid, maxLights = MAX_SHADER_SHIP_LIGHTS) {
  const lights = getEntityLights(entity);
  const scale = getEntityLightScale(entity);
  const limit = clampLightLimit(maxLights);
  const floods = Array.isArray(lights?.[LIGHT_KINDS.FLOOD]) ? lights[LIGHT_KINDS.FLOOD] : [];
  const hullLen = floods.length ? getEntityHullLengthWorld(entity, lights) : 0;
  // Wymiary siatki dokładnie w postaci, której używają packLight i podpis.
  const srcW = Number(grid?.srcWidth) || 1;
  const srcH = Number(grid?.srcHeight) || 1;
  const pivotX = Number(grid?.pivot?.x) || 0;
  const pivotY = Number(grid?.pivot?.y) || 0;
  const cacheable = entity !== null && typeof entity === 'object';
  let cached = cacheable ? ownPayloadCache.get(entity) : undefined;
  if (cached === undefined || cached.block !== lights || cached.scaleX !== scale.x || cached.scaleY !== scale.y ||
      cached.limit !== limit || cached.hullLen !== hullLen || cached.srcW !== srcW || cached.srcH !== srcH ||
      cached.pivotX !== pivotX || cached.pivotY !== pivotY) {
    const own = packOwnShipLights(lights, scale, limit, hullLen, grid);
    cached = {
      block: lights, scaleX: scale.x, scaleY: scale.y, limit, hullLen, srcW, srcH, pivotX, pivotY,
      lights: own.lights, signature: own.signature
    };
    if (cacheable) ownPayloadCache.set(entity, cached);
  }
  return {
    count: cached.lights.length,
    lights: cached.lights.slice(),
    signature: cached.signature
  };
}

function packOwnShipLights(lights, scale, limit, hullLen, grid) {
  const out = [];
  const pushKind = (kind) => {
    const markers = Array.isArray(lights?.[kind]) ? lights[kind] : [];
    for (let i = 0; i < markers.length && out.length < limit; i++) {
      if (kind === LIGHT_KINDS.FLOOD && !floodLightAllowed(markers[i], hullLen)) continue;
      out.push(packLight(markers[i], kind, grid, scale));
    }
  };

  // Kierunkowe najpierw: przy nadmiarze lamp wypada kolejna lampa pozycyjna,
  // a nie reflektor (dawniej Atlas tracił w shaderze oba reflektory dziobu).
  pushKind(LIGHT_KINDS.ROAD);
  pushKind(LIGHT_KINDS.FLOOD);
  pushKind(LIGHT_KINDS.POSITION);

  // Te same składniki co dawny podpis tekstowy, w tej samej kolejności.
  let hash = FNV_OFFSET_BASIS;
  hash = hashMixNumber(hash, Number(grid?.srcWidth) || 1);
  hash = hashMixNumber(hash, Number(grid?.srcHeight) || 1);
  hash = hashMixNumber(hash, Number(grid?.pivot?.x) || 0);
  hash = hashMixNumber(hash, Number(grid?.pivot?.y) || 0);
  hash = hashMixNumber(hash, scale.x);
  hash = hashMixNumber(hash, scale.y);
  for (let i = 0; i < out.length; i++) {
    const light = out[i];
    hash = hashMixString(hash, light.id);
    hash = hashMixString(hash, light.kind);
    hash = hashMixNumber(hash, light.pos.x);
    hash = hashMixNumber(hash, light.pos.y);
    hash = hashMixNumber(hash, light.color.r);
    hash = hashMixNumber(hash, light.color.g);
    hash = hashMixNumber(hash, light.color.b);
    hash = hashMixNumber(hash, light.radiusPx);
    hash = hashMixNumber(hash, light.power);
    hash = hashMixNumber(hash, light.dir.x);
    hash = hashMixNumber(hash, light.dir.y);
    hash = hashMixNumber(hash, light.rangePx);
    hash = hashMixNumber(hash, light.coneDeg);
  }

  return {
    lights: out,
    signature: hash >>> 0
  };
}

// Ród kadłuba belkowego (hullBodies.js: `dmgKey` — kadłub, jego wrak i odłamy z rozpadu), 0 = brak.
// Lampy leżą w pikselach sprite'a WŁAŚCICIELA, więc po rozpadzie lampy odpadłej części stoją dokładnie
// na odłamie: jako światło „innego statku” zalewały go rozlewem z odległości 0 (różowa rufa Atlasa,
// biały klin reflektora). Przed rozpadem kadłub nie dostaje rozlewu własnych lamp — odłam rodu też nie.
function lightLineageOf(entity) {
  const key = entity?.beamHull?.dmgKey;
  return key > 0 ? key : 0;
}

export function buildRoadLightWorldEmitters(entities, options = {}) {
  const out = Array.isArray(options.out) ? options.out : [];
  if (options.clear !== false) out.length = 0;
  const list = Array.isArray(entities) ? entities : [];
  const maxEmitters = Math.max(0, Math.floor(Number(options.maxEmitters) || 256));

  // Reflektory otoczenia (flood) wchodzą jako emitery z `flood: true` — światło
  // pola i kadłuby innych statków traktują je jak krótki, szeroki reflektor.
  const withFloods = options.floods !== false;
  for (let entityIndex = 0; entityIndex < list.length && out.length < maxEmitters; entityIndex++) {
    const entity = list[entityIndex];
    if (!entity || entity.dead) continue;
    const lights = getEntityLights(entity);
    const roads = Array.isArray(lights?.road) ? lights.road : [];
    const floods = withFloods && Array.isArray(lights?.flood) ? lights.flood : EMPTY_LIGHTS_BLOCK.flood;
    if (!roads.length && !floods.length) continue;
    const cloakGain = cloakLightGain(entity);
    if (cloakGain <= 0.01) continue;

    const hardpointScale = getEntityLightScale(entity);
    const spriteScale = getEntitySpriteScale(entity, options);
    const pos = getEntityPosition(entity, options);
    const angle = getEntityAngle(entity, options);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const hullLen = floods.length ? getEntityHullLengthWorld(entity, lights, options) : 0;
    const total = roads.length + floods.length;
    const lineage = lightLineageOf(entity);

    for (let i = 0; i < total && out.length < maxEmitters; i++) {
      const flood = i >= roads.length;
      const marker = flood ? floods[i - roads.length] : roads[i];
      if (flood && !floodLightAllowed(marker, hullLen)) continue;
      const defaults = LIGHT_DEFAULTS[flood ? LIGHT_KINDS.FLOOD : LIGHT_KINDS.ROAD];
      const local = getScaledLightLocal(marker, hardpointScale);
      const dirLocal = lightDirection(marker?.deg ?? defaults.deg);
      const scaledDir = normalizeVec2(
        dirLocal.x * spriteScale.x,
        dirLocal.y * spriteScale.y,
        1,
        0
      );
      const worldDir = normalizeVec2(
        scaledDir.x * c - scaledDir.y * s,
        scaledDir.x * s + scaledDir.y * c,
        1,
        0
      );
      const scaledLocalX = local.x * spriteScale.x;
      const scaledLocalY = local.y * spriteScale.y;
      const spriteDirectionalScale = directionalScale(dirLocal, spriteScale);
      const rangePx = clamp(marker?.range, 50, 4000, defaults.range) * directionalScale(dirLocal, hardpointScale);
      const radiusPx = clamp(marker?.radius, 1, 48, defaults.radius) * (Number(hardpointScale?.uniform) || 1);

      out.push({
        owner: entity,
        ownerId: entity?.id || entity?.uid || entity?.name || `entity${entityIndex}`,
        lineage,
        id: marker?.id || `road${i}`,
        flood,
        x: round2(pos.x + scaledLocalX * c - scaledLocalY * s),
        y: round2(pos.y + scaledLocalX * s + scaledLocalY * c),
        dir: worldDir,
        color: cachedRgb01(marker?.color, defaults.color),
        radiusWorld: round2(radiusPx * (Number(spriteScale?.uniform) || 1)),
        power: round2(clamp(marker?.power, 0.05, 20, defaults.power) * cloakGain),
        rangeWorld: round2(rangePx * spriteDirectionalScale),
        coneDeg: round2(clamp(marker?.coneDeg, 8, 160, defaults.coneDeg))
      });
    }
  }

  return out;
}

// Grupy lamp pozycyjnych bloku (px sprite'a): burta × połowa długości, do
// NAV_CLUSTER.maxGroups. Cache w bloku (blok jest per źródło, tylko do odczytu).
function getNavGroups(block) {
  if (block.__navGroups) return block.__navGroups;
  const markers = Array.isArray(block?.[LIGHT_KINDS.POSITION]) ? block[LIGHT_KINDS.POSITION] : [];
  const groups = [];
  if (markers.length) {
    let xMin = Infinity;
    let xMax = -Infinity;
    for (const m of markers) { if (m.x < xMin) xMin = m.x; if (m.x > xMax) xMax = m.x; }
    const xMid = (xMin + xMax) * 0.5;
    const buckets = [[], [], [], []];
    for (const m of markers) buckets[(m.y < 0 ? 0 : 2) + (m.x < xMid ? 0 : 1)].push(m);
    for (const b of buckets) {
      if (!b.length) continue;
      let cx = 0; let cy = 0; let power = 0; let r = 0; let g = 0; let bl = 0;
      for (const m of b) {
        cx += m.x; cy += m.y;
        const p = clamp(m.power, 0.05, 20, 0.8);
        const col = hexToRgb01(m.color, '#ff2b2b');
        power += p; r += col.r * p; g += col.g * p; bl += col.b * p;
      }
      cx /= b.length; cy /= b.length;
      let spread = 0;
      for (const m of b) spread = Math.max(spread, Math.hypot(m.x - cx, m.y - cy));
      groups.push({
        x: cx, y: cy, spreadPx: spread, count: b.length, power,
        color: { r: r / power, g: g / power, b: bl / power },
        xs: Float64Array.from(b, (m) => m.x)
      });
    }
  }
  Object.defineProperty(block, '__navGroups', { value: groups, enumerable: false });
  return groups;
}

// Mnożnik sekwencji „pasa startowego” lampy o fazie `phase` w chwili t — ta
// sama formuła co pętla lamp kadłuba i billboardy (NAV_LIGHT_CHASE).
export function navChaseSequence(t, phase) {
  const C = NAV_LIGHT_CHASE;
  const chase = ((t * C.speed + phase * C.phaseGain) % 1 + 1) % 1;
  const pulse = smoothstep01(0, C.attack, chase) * (1 - smoothstep01(C.hold, C.release, chase));
  return C.rest + (1 - C.rest) * pulse;
}

/**
 * Grupy lamp pozycyjnych jako światła w świecie (rozlew czerwieni na skały
 * i inne kadłuby). Jedno światło na grupę zamiast kilkudziesięciu lamp.
 * `pulse` = średnia sekwencji lamp grupy w chwili options.time (błysk biegnie
 * po skałach razem z billboardami); `mean` = średnia w cyklu (stała — do
 * payloadu kadłubów, żeby podpis nie zmieniał się co klatkę).
 */
export function buildNavLightClusters(entities, options = {}) {
  const out = Array.isArray(options.out) ? options.out : [];
  if (options.clear !== false) out.length = 0;
  const list = Array.isArray(entities) ? entities : [];
  const maxClusters = Math.max(0, Math.floor(Number(options.maxClusters) || 256));
  const time = Number(options.time) || 0;
  for (let entityIndex = 0; entityIndex < list.length && out.length < maxClusters; entityIndex++) {
    const entity = list[entityIndex];
    if (!entity || entity.dead) continue;
    const lights = getEntityLights(entity);
    if (!lights?.[LIGHT_KINDS.POSITION]?.length) continue;
    const cloakGain = cloakLightGain(entity);
    if (cloakGain <= 0.01) continue;
    const groups = getNavGroups(lights);
    const hardpointScale = getEntityLightScale(entity);
    const spriteScale = getEntitySpriteScale(entity, options);
    const pos = getEntityPosition(entity, options);
    const angle = getEntityAngle(entity, options);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const grid = typeof options.getGrid === 'function' ? options.getGrid(entity) : entity?.hexGrid;
    const width = Math.max(1, Number(grid?.srcWidth) || (lights.hullLenPx * hardpointScale.x * 1.1) || 1);
    const pivotX = Number(grid?.pivot?.x) || 0;
    const worldScale = (Number(hardpointScale.uniform) || 1) * (Number(spriteScale.uniform) || 1);
    const lineage = lightLineageOf(entity);
    for (let gi = 0; gi < groups.length && out.length < maxClusters; gi++) {
      const g = groups[gi];
      const lx = g.x * hardpointScale.x * spriteScale.x;
      const ly = g.y * hardpointScale.y * spriteScale.y;
      let seq = 0;
      for (let k = 0; k < g.xs.length; k++) {
        const phase = Math.max(0, Math.min(1, (g.xs[k] * hardpointScale.x + width * 0.5 + pivotX) / width));
        seq += navChaseSequence(time, phase);
      }
      seq /= Math.max(1, g.xs.length);
      out.push({
        owner: entity,
        ownerId: entity?.id || entity?.uid || entity?.name || `entity${entityIndex}`,
        lineage,
        id: `nav${gi}`,
        x: pos.x + lx * c - ly * s,
        y: pos.y + lx * s + ly * c,
        color: g.color,
        power: cloakGain < 1 ? g.power * cloakGain : g.power,
        count: g.count,
        spreadWorld: g.spreadPx * worldScale,
        rangeWorld: g.spreadPx * worldScale + NAV_CLUSTER.reachWorld,
        pulse: seq,
        mean: NAV_CLUSTER.meanSequence
      });
    }
  }
  return out;
}

function smoothstep01(edge0, edge1, value) {
  const span = edge1 - edge0;
  if (!(span > 0)) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / span));
  return t * t * (3 - 2 * t);
}

// Światła pozycyjne jako sprite'y w koordach świata — źródło danych dla
// addytywnych billboardów blasku (shipLights3D, warstwa FG po shadow-passie).
// phase liczymy IDENTYCZNIE jak pętla lamp w shaderze kadłuba
// (sprite-px X / szerokość sprite'a), żeby błysk billboardu i rozświetlenie
// kadłuba były tym samym momentem sekwencji.
export function buildPositionLightWorldSprites(entities, options = {}) {
  const out = Array.isArray(options.out) ? options.out : [];
  if (options.clear !== false) out.length = 0;
  const list = Array.isArray(entities) ? entities : [];
  const maxSprites = Math.max(0, Math.min(MAX_NAV_LIGHT_SPRITES, Math.floor(Number(options.maxSprites) || MAX_NAV_LIGHT_SPRITES)));
  const haloScale = Number(options.haloScale) > 0 ? Number(options.haloScale) : 16;
  const minHaloWorld = Math.max(0, Number(options.minHaloWorld) || 0);
  const zoom = Number(options.zoom);
  const hasZoom = Number.isFinite(zoom) && zoom > 0;

  for (let entityIndex = 0; entityIndex < list.length && out.length < maxSprites; entityIndex++) {
    const entity = list[entityIndex];
    if (!entity || entity.dead) continue;
    const lights = getEntityLights(entity);
    const markers = Array.isArray(lights?.position) ? lights.position : [];
    if (!markers.length) continue;

    const grid = typeof options.getGrid === 'function' ? options.getGrid(entity) : entity?.hexGrid;
    const hardpointScale = getEntityLightScale(entity);
    const spriteScale = getEntitySpriteScale(entity, options);
    const pos = getEntityPosition(entity, options);
    const angle = getEntityAngle(entity, options);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const width = Math.max(1, Number(grid?.srcWidth) || 1);
    const pivotX = Number(grid?.pivot?.x) || 0;

    // Daleki zoom: statek ma pojedyncze piksele — wygaszamy lampy zamiast
    // malować czerwoną plamę większą od kadłuba.
    let fade = 1;
    if (hasZoom) {
      const radiusWorld = getEntityRadiusWorld(entity, grid, spriteScale, options);
      const screenRadiusPx = radiusWorld * zoom;
      if (screenRadiusPx < 2.5) continue;
      fade = smoothstep01(2.5, 9, screenRadiusPx);
    }

    for (let i = 0; i < markers.length && out.length < maxSprites; i++) {
      const marker = markers[i];
      const local = getScaledLightLocal(marker, hardpointScale);
      const phase = Math.max(0, Math.min(1, (local.x + width * 0.5 + pivotX) / width));
      const scaledLocalX = local.x * spriteScale.x;
      const scaledLocalY = local.y * spriteScale.y;
      const radiusPx = clamp(marker?.radius, 1, 48, 4) * (Number(hardpointScale?.uniform) || 1);
      const coreWorld = Math.max(0.25, radiusPx * (Number(spriteScale?.uniform) || 1));
      const haloWorld = Math.max(coreWorld * haloScale, minHaloWorld);
      const wx = pos.x + scaledLocalX * c - scaledLocalY * s;
      const wy = pos.y + scaledLocalX * s + scaledLocalY * c;
      // Maskowanie: lampa gaśnie razem z komórką kadłuba pod sobą (lustro wzoru z shadera).
      const cloakVis = entity.__cloakLook ? entityCloakVisAt(entity, wx, wy) : 1;
      if (cloakVis <= 0.01) continue;

      out.push({
        x: round2(wx),
        y: round2(wy),
        phase: round2(phase),
        color: cachedRgb01(marker?.color, '#ff2b2b'),
        coreWorld: round2(coreWorld),
        haloWorld: round2(haloWorld),
        intensity: round2(clamp(marker?.power, 0.05, 20, 0.8) * fade * cloakVis)
      });
    }
  }

  return out;
}

// Pudło zasięgu wszystkich emiterów drogowych klatki. Cel poza nim nie dostanie
// światła z żadnego emitera (roadEmitterAffectsTarget), więc payload świateł
// zewnętrznych można pominąć bez pętli po emiterach. Z testu stożka:
// |P − E| ≤ range·(1 + tan φ) + R·(2 + tan φ), φ = połowa kąta stożka, R = promień celu.
export function createRoadEmitterReach() {
  return { count: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, tanMax: 0 };
}

export function computeRoadEmitterReach(emitters, out) {
  out.count = 0;
  out.minX = Infinity;
  out.maxX = -Infinity;
  out.minY = Infinity;
  out.maxY = -Infinity;
  out.tanMax = 0;
  const list = Array.isArray(emitters) ? emitters : [];
  for (let i = 0; i < list.length; i++) {
    const emitter = list[i];
    if (!emitter) continue;
    const range = Math.max(1, Number(emitter.rangeWorld) || 1);
    const tan = Math.tan(clamp(emitter.coneDeg, 8, 160, 40) * Math.PI / 360);
    const reach = range * (1 + tan);
    const x = Number(emitter.x) || 0;
    const y = Number(emitter.y) || 0;
    if (x - reach < out.minX) out.minX = x - reach;
    if (x + reach > out.maxX) out.maxX = x + reach;
    if (y - reach < out.minY) out.minY = y - reach;
    if (y + reach > out.maxY) out.maxY = y + reach;
    if (tan > out.tanMax) out.tanMax = tan;
    out.count++;
  }
  return out;
}

export function roadEmittersMayReach(reach, entity, grid, options = {}) {
  if (!reach || reach.count === 0) return false;
  const pos = getEntityPosition(entity, options);
  const radius = getEntityRadiusWorld(entity, grid, getEntitySpriteScale(entity, options), options);
  const inflate = radius * (2 + reach.tanMax);
  return pos.x >= reach.minX - inflate && pos.x <= reach.maxX + inflate
    && pos.y >= reach.minY - inflate && pos.y <= reach.maxY + inflate;
}

// Testy „czy światło innego statku sięga kadłuba celu” dostają pozycję (tx, ty)
// i promień celu policzone RAZ na payload: pętle idą po wszystkich emiterach
// i grupach lamp dla każdego kadłuba w każdej klatce (O(kadłuby × światła)),
// a pozycja/skala/promień celu liczone per para były największym kosztem
// „U hex” w dużej bitwie. Zwracają kwadrat odległości (ranking najbliższych)
// albo −1, gdy światło nie sięga.

// Stożek reflektora vs koło celu.
function roadEmitterReachDistSq(emitter, tx, ty, targetRadius) {
  const dx = tx - (Number(emitter.x) || 0);
  const dy = ty - (Number(emitter.y) || 0);
  const dirX = Number(emitter.dir?.x) || 0;
  const dirY = Number(emitter.dir?.y) || 0;
  const along = dx * dirX + dy * dirY;
  const range = Math.max(1, Number(emitter.rangeWorld) || 1);
  if (along < -targetRadius || along > range + targetRadius) return -1;

  const distSq = dx * dx + dy * dy;
  const perpSq = Math.max(0, distSq - along * along);
  const halfRad = clamp(emitter.coneDeg, 8, 160, 40) * Math.PI / 360;
  const coneRadius = Math.max(0, along) * Math.tan(halfRad) + targetRadius;
  return perpSq <= coneRadius * coneRadius ? distSq : -1;
}

// Najbliższe światła celu bez sortowania wszystkich kandydatów (w bitwie setki
// na kadłub): bufor `limit` najmniejszych odległości, remis → wcześniejsze
// światło — to samo, co stabilny sort całej listy i pierwsze `limit`.
const NEAREST_CAPACITY = Math.max(MAX_EXTERNAL_OMNI_SHADER_LIGHTS, MAX_EXTERNAL_ROAD_SHADER_LIGHTS);
const _nearItems = new Array(NEAREST_CAPACITY).fill(null);
const _nearScores = new Float64Array(NEAREST_CAPACITY);

function insertNearest(count, limit, score, item) {
  if (count >= limit) {
    if (limit <= 0 || !(score < _nearScores[limit - 1])) return count;
    count = limit - 1; // najdalszy wypada
  }
  let i = count;
  while (i > 0 && _nearScores[i - 1] > score) {
    _nearScores[i] = _nearScores[i - 1];
    _nearItems[i] = _nearItems[i - 1];
    i--;
  }
  _nearScores[i] = score;
  _nearItems[i] = item;
  return count + 1;
}

// To samo co insertNearest dla kandydatów w DOWOLNEJ kolejności (indeks przestrzenny niżej): remis rozstrzyga
// indeks światła na liście — wynik = stabilny sort całej listy po odległości i pierwsze `limit`.
const _nearIdx = new Int32Array(NEAREST_CAPACITY);
function insertNearestIdx(count, limit, score, idx, item) {
  if (count >= limit) {
    if (limit <= 0) return count;
    const ws = _nearScores[limit - 1];
    if (!(score < ws || (score === ws && idx < _nearIdx[limit - 1]))) return count;
    count = limit - 1;
  }
  let i = count;
  while (i > 0 && (_nearScores[i - 1] > score || (_nearScores[i - 1] === score && _nearIdx[i - 1] > idx))) {
    _nearScores[i] = _nearScores[i - 1];
    _nearIdx[i] = _nearIdx[i - 1];
    _nearItems[i] = _nearItems[i - 1];
    i--;
  }
  _nearScores[i] = score;
  _nearIdx[i] = idx;
  _nearItems[i] = item;
  return count + 1;
}

// ── Indeks przestrzenny świateł zewnętrznych klatki (2026-10-07, koszt renderu w bitwie) ────────────
// buildCombinedShipLightShaderPayload sprawdzał KAŻDY reflektor i KAŻDĄ grupę lamp z kadru dla każdego
// kadłuba: 166 okrętów × ~1300 świateł ≈ 220 tys. testów na klatkę (~70% kosztu payloadu). Indeks: siatka
// komórek (CSR) nad pudłami zasięgu świateł; kadłub sprawdza tylko światła z komórek swojego pudła.
// Pudła jak computeRoadEmitterReach / roadEmittersMayReach: reflektor ±range·(1+tan φ), cel ±R·(2+tan φmax)
// (test stożka przepuszcza środek celu do range+R wzdłuż osi i along·tan φ+R w bok, więc |cel−reflektor| ≤
// range·(1+tan φ)+R·(2+tan φ)); grupa lamp ±range, cel ±R. Do tego 1 j. zapasu na zaokrąglenia — światło, które
// przechodzi test, ma komórkę wspólną z pudłem celu. Testy, ranking i pakowanie bez zmian (remisy po indeksie).
const LIGHT_INDEX_CELL = 1536;
const LIGHT_INDEX_MAX_CELLS = 96;
const LIGHT_INDEX_PAD = 1;

export function createExternalLightIndex() {
  return {
    valid: false, emitters: null, omni: null, emitterCount: -1, omniCount: -1,
    x0: 0, y0: 0, inv: 1, nx: 0, ny: 0, tanMax: 0,
    e: createLightCellList(), o: createLightCellList()
  };
}

function createLightCellList() {
  return {
    start: new Int32Array(2), items: new Int32Array(16), boxes: new Float64Array(16), seen: new Int32Array(16), stamp: 0
  };
}

function emitterReachBox(emitter, out, k) {
  const range = Math.max(1, Number(emitter.rangeWorld) || 1);
  const tan = Math.tan(clamp(emitter.coneDeg, 8, 160, 40) * Math.PI / 360);
  const reach = range * (1 + tan) + LIGHT_INDEX_PAD;
  const x = Number(emitter.x) || 0;
  const y = Number(emitter.y) || 0;
  out[k] = x - reach; out[k + 1] = y - reach; out[k + 2] = x + reach; out[k + 3] = y + reach;
}

function omniReachBox(light, out, k) {
  const reach = Math.max(1, Number(light.rangeWorld) || 1) + LIGHT_INDEX_PAD;
  const x = Number(light.x) || 0;
  const y = Number(light.y) || 0;
  out[k] = x - reach; out[k + 1] = y - reach; out[k + 2] = x + reach; out[k + 3] = y + reach;
}

function fillLightBoxes(cells, list, boxOf) {
  const n = list.length;
  if (cells.boxes.length < n * 4) cells.boxes = new Float64Array(Math.max(n * 4, cells.boxes.length * 2));
  if (cells.seen.length < n) { cells.seen = new Int32Array(Math.max(n, cells.seen.length * 2)); cells.stamp = 0; }
  const B = cells.boxes;
  for (let i = 0; i < n; i++) {
    const item = list[i];
    if (item) boxOf(item, B, i * 4);
    else { B[i * 4] = Infinity; B[i * 4 + 1] = Infinity; B[i * 4 + 2] = -Infinity; B[i * 4 + 3] = -Infinity; }
  }
}

function fillLightCells(index, cells, n) {
  const cellCount = index.nx * index.ny;
  if (cells.start.length < cellCount + 1) cells.start = new Int32Array(cellCount + 1);
  const start = cells.start;
  start.fill(0, 0, cellCount + 1);
  const B = cells.boxes;
  const { x0, y0, inv, nx, ny } = index;
  // przebieg 1: liczba wpisów w komórce, przebieg 2: wpisy (rosnąco po indeksie światła)
  let total = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    if (!(B[k] <= B[k + 2])) continue;
    const cx0 = Math.max(0, Math.floor((B[k] - x0) * inv));
    const cy0 = Math.max(0, Math.floor((B[k + 1] - y0) * inv));
    const cx1 = Math.min(nx - 1, Math.floor((B[k + 2] - x0) * inv));
    const cy1 = Math.min(ny - 1, Math.floor((B[k + 3] - y0) * inv));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) { start[cy * nx + cx + 1]++; total++; }
  }
  for (let c = 0; c < cellCount; c++) start[c + 1] += start[c];
  if (cells.items.length < total) cells.items = new Int32Array(Math.max(total, cells.items.length * 2));
  const items = cells.items;
  // kursor zapisu = start komórki (przesunięty o jeden; po wypełnieniu start[c] wraca na początek komórki)
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    if (!(B[k] <= B[k + 2])) continue;
    const cx0 = Math.max(0, Math.floor((B[k] - x0) * inv));
    const cy0 = Math.max(0, Math.floor((B[k + 1] - y0) * inv));
    const cx1 = Math.min(nx - 1, Math.floor((B[k + 2] - x0) * inv));
    const cy1 = Math.min(ny - 1, Math.floor((B[k + 3] - y0) * inv));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) items[start[cy * nx + cx]++] = i;
  }
  for (let c = cellCount; c > 0; c--) start[c] = start[c - 1];
  start[0] = 0;
}

/**
 * Indeks świateł zewnętrznych tej klatki: reflektory (buildRoadLightWorldEmitters) i grupy lamp / światła
 * świata (buildNavLightClusters + dopisane). Ważny, dopóki listy (te same tablice, te same długości) się nie
 * zmienią — buildCombinedShipLightShaderPayload sprawdza to sam i bez ważnego indeksu przegląda listy w całości.
 */
export function buildExternalLightIndex(index, emitters, omni) {
  const E = Array.isArray(emitters) ? emitters : [];
  const O = Array.isArray(omni) ? omni : [];
  fillLightBoxes(index.e, E, emitterReachBox);
  fillLightBoxes(index.o, O, omniReachBox);
  let tanMax = 0;
  for (let i = 0; i < E.length; i++) {
    const e = E[i];
    if (!e) continue;
    const tan = Math.tan(clamp(e.coneDeg, 8, 160, 40) * Math.PI / 360);
    if (tan > tanMax) tanMax = tan;
  }
  index.tanMax = tanMax;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [cells, n] of [[index.e, E.length], [index.o, O.length]]) {
    const B = cells.boxes;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      if (!(B[k] <= B[k + 2])) continue;
      if (B[k] < minX) minX = B[k];
      if (B[k + 1] < minY) minY = B[k + 1];
      if (B[k + 2] > maxX) maxX = B[k + 2];
      if (B[k + 3] > maxY) maxY = B[k + 3];
    }
  }
  index.emitters = E;
  index.omni = O;
  index.emitterCount = E.length;
  index.omniCount = O.length;
  if (!(minX <= maxX) || !Number.isFinite(minX + minY + maxX + maxY)) {
    // nic do indeksowania (albo pudło nieskończone) — przegląd całych list
    index.valid = false;
    return index;
  }
  const cell = Math.max(LIGHT_INDEX_CELL, (maxX - minX) / LIGHT_INDEX_MAX_CELLS, (maxY - minY) / LIGHT_INDEX_MAX_CELLS);
  index.x0 = minX;
  index.y0 = minY;
  index.inv = 1 / cell;
  index.nx = Math.max(1, Math.min(LIGHT_INDEX_MAX_CELLS, Math.floor((maxX - minX) / cell) + 1));
  index.ny = Math.max(1, Math.min(LIGHT_INDEX_MAX_CELLS, Math.floor((maxY - minY) / cell) + 1));
  fillLightCells(index, index.e, E.length);
  fillLightCells(index, index.o, O.length);
  index.valid = true;
  return index;
}

function externalIndexFor(options, emitters, omni) {
  const index = options?.externalIndex;
  if (!index || !index.valid) return null;
  if (index.emitters !== emitters || index.omni !== omni) return null;
  if (index.emitterCount !== emitters.length || index.omniCount !== omni.length) return null;
  return index;
}

function nextLightStamp(cells) {
  let stamp = cells.stamp + 1;
  if (stamp > 0x3fffffff) { cells.seen.fill(0); stamp = 1; }
  cells.stamp = stamp;
  return stamp;
}

// Najbliższe grupy lamp (koło zasięgu) z komórek pudła celu — wynik jak pętla po całej liście w buildCombined….
function nearestOmniIndexed(index, omni, entity, lineage, tx, ty, R, limit) {
  const cells = index.o;
  const stamp = nextLightStamp(cells);
  const seen = cells.seen;
  const start = cells.start;
  const items = cells.items;
  const x0 = index.x0;
  const y0 = index.y0;
  const inv = index.inv;
  const nx = index.nx;
  const ny = index.ny;
  const cx0 = Math.max(0, Math.min(nx - 1, Math.floor((tx - R - x0) * inv)));
  const cx1 = Math.max(0, Math.min(nx - 1, Math.floor((tx + R - x0) * inv)));
  const cy0 = Math.max(0, Math.min(ny - 1, Math.floor((ty - R - y0) * inv)));
  const cy1 = Math.max(0, Math.min(ny - 1, Math.floor((ty + R - y0) * inv)));
  let near = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * nx + cx;
      for (let k = start[c], end = start[c + 1]; k < end; k++) {
        const i = items[k];
        if (seen[i] === stamp) continue;
        seen[i] = stamp;
        const light = omni[i];
        if (!light || light.owner === entity || (lineage !== 0 && light.lineage === lineage) || !(light.power > 0)) continue;
        const distSq = omniLightReachDistSq(light, tx, ty, R);
        if (distSq >= 0) near = insertNearestIdx(near, limit, distSq, i, light);
      }
    }
  }
  return near;
}

// Reflektory (stożek) z komórek pudła celu; _emitterAny — czy któryś sięgnął celu (jak anyCandidate).
let _emitterAny = false;
function nearestEmittersIndexed(index, emitters, entity, lineage, tx, ty, R, keep) {
  const cells = index.e;
  const Q = R * (2 + index.tanMax) + LIGHT_INDEX_PAD;
  const stamp = nextLightStamp(cells);
  const seen = cells.seen;
  const start = cells.start;
  const items = cells.items;
  const x0 = index.x0;
  const y0 = index.y0;
  const inv = index.inv;
  const nx = index.nx;
  const ny = index.ny;
  const cx0 = Math.max(0, Math.min(nx - 1, Math.floor((tx - Q - x0) * inv)));
  const cx1 = Math.max(0, Math.min(nx - 1, Math.floor((tx + Q - x0) * inv)));
  const cy0 = Math.max(0, Math.min(ny - 1, Math.floor((ty - Q - y0) * inv)));
  const cy1 = Math.max(0, Math.min(ny - 1, Math.floor((ty + Q - y0) * inv)));
  let near = 0;
  let any = false;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * nx + cx;
      for (let k = start[c], end = start[c + 1]; k < end; k++) {
        const i = items[k];
        if (seen[i] === stamp) continue;
        seen[i] = stamp;
        const emitter = emitters[i];
        if (!emitter || emitter.owner === entity || (lineage !== 0 && emitter.lineage === lineage)) continue;
        const distSq = roadEmitterReachDistSq(emitter, tx, ty, R);
        if (distSq < 0) continue;
        any = true;
        near = insertNearestIdx(near, keep, distSq, i, emitter);
      }
    }
  }
  _emitterAny = any;
  return near;
}

function packExternalRoadLightForTarget(emitter, entity, grid, options = {}) {
  const targetScale = getEntitySpriteScale(entity, options);
  const dir = worldDirToEntitySpriteDir(emitter?.dir, entity, options);
  const directionalTargetScale = directionalScale(dir, targetScale);
  return {
    id: `external:${emitter?.ownerId || 'ship'}:${emitter?.id || 'road'}`,
    kind: emitter?.flood ? LIGHT_KINDS.FLOOD : LIGHT_KINDS.ROAD,
    external: true,
    pos: worldToEntitySpritePixels(emitter?.x, emitter?.y, entity, grid, options),
    color: emitter?.color || hexToRgb01('#ffffff'),
    radiusPx: round2(Math.max(0.5, (Number(emitter?.radiusWorld) || 1) / Math.max(EPSILON, targetScale.uniform))),
    power: round2(clamp(emitter?.power, 0.05, 20, 3)),
    dir,
    rangePx: round2(Math.max(1, (Number(emitter?.rangeWorld) || 1) / Math.max(EPSILON, directionalTargetScale))),
    coneDeg: round2(clamp(emitter?.coneDeg, 8, 160, 40))
  };
}

// Grupa lamp pozycyjnych innego statku vs kadłub celu (koło zasięgu vs koło celu).
function omniLightReachDistSq(light, tx, ty, targetRadius) {
  const reach = Math.max(1, Number(light.rangeWorld) || 1) + targetRadius;
  const dx = tx - (Number(light.x) || 0);
  const dy = ty - (Number(light.y) || 0);
  const distSq = dx * dx + dy * dy;
  return distSq <= reach * reach ? distSq : -1;
}

// Rozlew grupy lamp w przestrzeni sprite'a celu: rodzaj 'omni' (typ 2 w shaderze
// kadłuba) — bez rdzenia lampy (lampa jest na innym kadłubie), tylko poświata.
function packExternalOmniLightForTarget(light, entity, grid, options = {}) {
  const targetScale = getEntitySpriteScale(entity, options);
  return {
    id: `external:${light?.ownerId || 'ship'}:${light?.id || 'nav'}`,
    kind: 'omni',
    external: true,
    pos: worldToEntitySpritePixels(light?.x, light?.y, entity, grid, options),
    color: light?.color || hexToRgb01('#ff2b2b'),
    radiusPx: 1,
    // Średnia sekwencji w cyklu (stała), nie bieżący błysk — podpis payloadu
    // nie zmienia się co klatkę.
    power: round2(Math.max(0, (Number(light?.power) || 0) * (Number(light?.mean) || NAV_CLUSTER.meanSequence))),
    dir: { x: 0, y: -1 },
    rangePx: round2(Math.max(1, (Number(light?.rangeWorld) || 1) / Math.max(EPSILON, targetScale.uniform))),
    coneDeg: 160
  };
}

export function buildCombinedShipLightShaderPayload(entity, grid, externalRoadLights = [], options = {}) {
  const maxLights = clampLightLimit(options?.maxLights);
  const payload = buildShipLightShaderPayload(entity, grid, maxLights);
  const emitters = Array.isArray(externalRoadLights) ? externalRoadLights : [];
  const omni = Array.isArray(options?.externalOmniLights) ? options.externalOmniLights : [];
  if ((!emitters.length && !omni.length) || payload.count >= maxLights) return payload;

  // Cel raz na payload, nie per światło (patrz roadEmitterReachDistSq).
  const targetPos = getEntityPosition(entity, options);
  const tx = targetPos.x;
  const ty = targetPos.y;
  const targetRadius = getEntityRadiusWorld(entity, grid, getEntitySpriteScale(entity, options), options);
  // Światła rodu celu (rodzic odłamu / wraku) to nie światła innego statku — patrz lightLineageOf.
  const lineage = lightLineageOf(entity);
  // Indeks przestrzenny klatki (buildExternalLightIndex) — tylko dla tych samych list; bez niego cała lista.
  const index = externalIndexFor(options, emitters, omni);

  // Rozlew czerwieni z grup lamp innych statków (przed reflektorami — to one
  // mają osobny, mały budżet MAX_EXTERNAL_OMNI_SHADER_LIGHTS).
  let hashOmni = null;
  if (omni.length) {
    const limit = Math.min(MAX_EXTERNAL_OMNI_SHADER_LIGHTS, maxLights - payload.count);
    let near = 0;
    if (index !== null) {
      near = nearestOmniIndexed(index, omni, entity, lineage, tx, ty, targetRadius, limit);
    } else {
      for (let i = 0; i < omni.length; i++) {
        const light = omni[i];
        if (!light || light.owner === entity || (lineage !== 0 && light.lineage === lineage) || !(light.power > 0)) continue;
        const distSq = omniLightReachDistSq(light, tx, ty, targetRadius);
        if (distSq >= 0) near = insertNearest(near, limit, distSq, light);
      }
    }
    for (let i = 0; i < near; i++) {
      const light = packExternalOmniLightForTarget(_nearItems[i], entity, grid, options);
      _nearItems[i] = null;
      payload.lights.push(light);
      if (hashOmni === null) hashOmni = Math.imul((payload.signature | 0) ^ 0x4f4d4e49, FNV_PRIME);
      hashOmni = hashMixString(hashOmni, light.id);
      hashOmni = hashMixNumber(hashOmni, light.pos.x);
      hashOmni = hashMixNumber(hashOmni, light.pos.y);
      hashOmni = hashMixNumber(hashOmni, light.rangePx);
      hashOmni = hashMixNumber(hashOmni, light.power);
    }
    if (hashOmni !== null) {
      payload.count = payload.lights.length;
      payload.signature = hashOmni >>> 0;
    }
  }
  if (!emitters.length || payload.count >= maxLights) return payload;

  const externalLimit = Math.max(0, Math.min(
    MAX_EXTERNAL_ROAD_SHADER_LIGHTS,
    Number(options?.maxExternalRoadLights) || MAX_EXTERNAL_ROAD_SHADER_LIGHTS,
    maxLights - payload.count
  ));
  // Pakujemy tylko światła, które wejdą do payloadu (dawniej każdego kandydata).
  const keep = Math.ceil(externalLimit);
  let near = 0;
  let anyCandidate = false;
  if (index !== null) {
    near = nearestEmittersIndexed(index, emitters, entity, lineage, tx, ty, targetRadius, keep);
    anyCandidate = _emitterAny;
  } else {
    for (let i = 0; i < emitters.length; i++) {
      const emitter = emitters[i];
      if (!emitter || emitter.owner === entity || (lineage !== 0 && emitter.lineage === lineage)) continue;
      const distSq = roadEmitterReachDistSq(emitter, tx, ty, targetRadius);
      if (distSq < 0) continue;
      anyCandidate = true;
      near = insertNearest(near, keep, distSq, emitter);
    }
  }

  if (!anyCandidate) return payload;

  let hash = Math.imul((payload.signature | 0) ^ HASH_EXTERNAL_SECTION, FNV_PRIME);
  for (let i = 0; i < near; i++) {
    const light = packExternalRoadLightForTarget(_nearItems[i], entity, grid, options);
    _nearItems[i] = null;
    payload.lights.push(light);
    hash = hashMixString(hash, light.id);
    hash = hashMixNumber(hash, light.pos.x);
    hash = hashMixNumber(hash, light.pos.y);
    hash = hashMixNumber(hash, light.dir.x);
    hash = hashMixNumber(hash, light.dir.y);
    hash = hashMixNumber(hash, light.rangePx);
    hash = hashMixNumber(hash, light.radiusPx);
    hash = hashMixNumber(hash, light.power);
    hash = hashMixNumber(hash, light.coneDeg);
  }

  payload.count = payload.lights.length;
  payload.signature = hash >>> 0;
  return payload;
}
