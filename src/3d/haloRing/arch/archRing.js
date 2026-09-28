// Ringi-archetypy (Z6, 2026-09-27): Mars = ECUMENE, Jowisz = ring Fable —
// INNE RINGI niż ring Ziemi (decyzja użytkownika: „kompletnie inne ringi, nie
// tylko skórka — sprawdź ECUMENE i ring od Fable z dem”). Habitat na zewnątrz
// jak Ziemia, ląd 1:1 z dem (dema/orbital_ring_demo.html, _2.html) w skali ×3.
//
// API = createHaloRing (index.js), więc klej gry (haloRingGame.js), kolizje,
// ruch v2 i demo biorą ring bez rozróżniania:
//   const ring = createArchRing({ planetRadius, seed, profile, quality, renderer });
//   ring.group, ring.layout, ring.uniforms, ring.update(dt, { camera, viewportHeight, gameView }),
//   ring.setSun(az, el), ring.setLayers({ default, fg }), ring.setCutaway(i, cut),
//   ring.setQuality(q), ring.terrainHeightAt(x, y, z), ring.k7Halls, ring.bays, ring.dispose()
//
// Wspólne z silnikiem Halo: układ (createHaloRingLayout z geometrią archetypu
// z profilu — ten sam dostają kolizje, ruch v2 i stacja-port), uniformy
// i model światła (haloRingTSL.js), hala K-7 z zatokami (standard stanowisk)
// i reguły FG (górna ściana nad płaszczyzną gry: zanik przy dużym
// powiększeniu, schowanie nad wąwozem habitatu, wycięcia nad graczem).
// Własne: cała reszta ringu (ecumene.js / fable.js) i bryły zatok i tranzytów
// w stylu dema (archPort.js). Nie tworzy renderera (AGENTS.md).
import * as THREE from 'three';
import { HALO_DEFAULT_LAYER, HALO_FG, HALO_QUALITY, haloPortComplexAngles, haloQualityLod, resolveHaloQuality } from '../haloRingConfig.js';
import { createHaloRingLayout } from '../haloRingLayout.js';
import { createHaloUniforms } from '../haloRingUniforms.js';
import { HaloPortK7 } from '../haloPortK7.js';
import { createK7Layout, k7Frame } from '../haloPortK7Layout.js';
import { haloBayLayouts } from '../haloPortBays.js';
import { ArchMaterials, archBatchMesh, archUnitGeometries } from './archMaterials.js';
import { buildArchPortBodies } from './archPort.js';
import { buildEcumeneRing } from './ecumene.js';
import { buildFableRing } from './fable.js';

export const ARCH_BUILDERS = Object.freeze({ ecumene: buildEcumeneRing, fable: buildFableRing });

const _inv = new THREE.Matrix4();
const _camWorld = new THREE.Vector3();
const _proj = new THREE.Matrix4();

export function createArchRing(options = {}) {
  const state = {
    options: { ...options },
    qualityKey: resolveHaloQuality(options.quality),
    layers: { default: HALO_DEFAULT_LAYER },
    sun: { azimuth: 0, elevation: 49 * Math.PI / 180 }
  };
  const group = new THREE.Group();
  const frustum = new THREE.Frustum();
  const camLocal = new THREE.Vector3();
  let layout = null;
  let uniforms = null;
  let parts = null;
  // Zadanie 11: bryły trafiają do `group` dopiero po rozgrzewce pipeline'ów (hak hosta
  // options.prewarm → Core3D.warmup) — dawniej pierwsza klatka przy Marsie / Jowiszu
  // budowała ~13 materiałów na zimno (0,7–0,8 s przestoju w harnessie). Bez haka od razu.
  let buildGen = 0;
  let attached = false;
  let readyPromise = Promise.resolve(true);

  function build() {
    layout = createHaloRingLayout(state.options);
    group.name = `ArchRing:${layout.archetype}`;
    const builder = ARCH_BUILDERS[layout.archetype];
    if (!builder) throw new Error(`createArchRing: nieznany archetyp ${layout.archetype}`);
    const quality = HALO_QUALITY[state.qualityKey];
    if (!uniforms) uniforms = createHaloUniforms(layout);
    uniforms.uDetailScale.value = haloQualityLod(quality).detailScale;
    const materials = new ArchMaterials(uniforms);
    const geos = archUnitGeometries();
    // port: bryły zatok i tranzytów (BG; światła trafiają do świateł ringu),
    // hale K-7 (BG + FG)
    const port = buildArchPortBodies(layout, layout.planetProfile.port, layout.archetype);
    const content = builder({ layout, uniforms, materials, geos, quality, seed: layout.seed, portLights: port.lights, portSolid: port.solid });
    const bg = [...content.bg];
    const fg = [...content.fg];

    const k7Halls = [];
    if (state.options.k7 !== false) {
      if (!state.bayLayouts) state.bayLayouts = haloBayLayouts(layout);
      else for (const bay of state.bayLayouts) bay.frame = k7Frame(layout, bay.theta);
      if (!state.hallLayouts) {
        state.hallLayouts = haloPortComplexAngles().map((angle, i) => {
          const l = i === 0 ? (state.k7Layout || (state.k7Layout = createK7Layout())) : createK7Layout();
          if (i > 0) {
            const c01 = l.berths[0];
            c01.occupied = null;
            c01.reserved = null;
          }
          return l;
        });
      }
      haloPortComplexAngles().forEach((angle, i) => {
        const bays = state.bayLayouts.filter((b) => b.complex === i);
        const hall = new HaloPortK7({ ringLayout: layout, uniforms, layout: state.hallLayouts[i], angle, index: i, bays, style: layout.planetProfile.port });
        hall.update(0, {});
        hall.setBerthLamps();
        k7Halls.push(hall);
      });
    }
    parts = { quality, materials, geos, content, bg, fg, k7Halls, k7: k7Halls[0] || null };
    applyLayers();
    applySun();
    attachAfterWarm();
  }

  // Podpięcie brył do `group` — po rozgrzewce ich pipeline'ów (albo od razu bez haka).
  function attachAfterWarm() {
    const gen = ++buildGen;
    const p = parts;
    const objects = [...p.bg, ...p.fg, ...p.k7Halls.map((h) => h.root)];
    const attach = () => {
      if (gen !== buildGen || parts !== p) return false;
      for (const o of objects) group.add(o);
      attached = true;
      return true;
    };
    attached = false;
    const prewarm = state.options.prewarm;
    if (typeof prewarm !== 'function') {
      readyPromise = Promise.resolve(attach());
      return;
    }
    const alive = () => gen === buildGen;
    const jobs = [prewarm(objects, { name: `ring ${layout.archetype}: bryły`, alive })];
    for (const hall of p.k7Halls) {
      const v = hall.roofWarmVariant();
      if (v.meshes.length) jobs.push(prewarm(v.meshes, { name: 'ring: dach K-7 przezroczysty', variant: v, alive }));
    }
    readyPromise = Promise.all(jobs).catch((err) => {
      console.warn('[ArchRing] rozgrzewka brył nie wyszła — pipeline’y powstaną przy pierwszym rysunku', err);
    }).then(attach);
  }

  function disposeParts() {
    if (!parts) return;
    buildGen++;
    attached = false;
    for (const o of [...parts.bg, ...parts.fg]) {
      group.remove(o);
      if (o.geometry) o.geometry.dispose();
    }
    for (const hall of parts.k7Halls) {
      group.remove(hall.root);
      hall.dispose();
    }
    parts.content.dispose?.();
    parts.materials.dispose();
    for (const g of Object.values(parts.geos)) g.dispose();
    parts = null;
  }

  function applyLayers() {
    if (!parts) return;
    const map = state.layers;
    const bgL = Number.isFinite(map.default) ? map.default : HALO_DEFAULT_LAYER;
    const fgL = Number.isFinite(map.fg) ? map.fg : bgL;
    for (const o of parts.bg) o.layers.set(bgL);
    for (const o of parts.fg) o.layers.set(fgL);
    for (const hall of parts.k7Halls) hall.setLayers(bgL, fgL);
  }

  function applySun() {
    const { azimuth, elevation } = state.sun;
    const ce = Math.cos(elevation);
    uniforms.uSunDir.value.set(ce * Math.cos(azimuth), ce * Math.sin(azimuth), Math.sin(elevation)).normalize();
  }

  // Kompleksy portu poza kadrem / za planetą / mniejsze niż ~3 px (jak index.js).
  const _hallC = new THREE.Vector3();
  const _hallS = new THREE.Sphere();
  function cullHalls(pixelAngle) {
    const halls = parts.k7Halls;
    if (!halls.length) return;
    const pc = uniforms.uPlanet.value;
    const minPx = haloQualityLod(parts.quality).k7Pixels;
    for (const hall of halls) {
      const B = hall.bounds;
      _hallC.set(B.x, B.y, B.z);
      let vis = true;
      const dist = _hallC.distanceTo(camLocal);
      if (pixelAngle > 0 && 2 * B.r / Math.max(dist, 1) / pixelAngle < minPx) vis = false;
      if (vis) {
        const dx = _hallC.x - camLocal.x;
        const dy = _hallC.y - camLocal.y;
        const dz = _hallC.z - camLocal.z;
        const len = Math.hypot(dx, dy, dz) || 1;
        const ox = pc.x - camLocal.x;
        const oy = pc.y - camLocal.y;
        const oz = pc.z - camLocal.z;
        const t = (ox * dx + oy * dy + oz * dz) / len;
        if (t > 0 && t < len - B.r) {
          const d2 = ox * ox + oy * oy + oz * oz - t * t;
          if (d2 < (pc.w - 500) * (pc.w - 500)) vis = false;
        }
      }
      if (vis) {
        _hallS.center.copy(_hallC);
        _hallS.radius = B.r;
        vis = frustum.intersectsSphere(_hallS);
      }
      hall.root.visible = vis;
    }
  }

  build();

  const api = {
    group,
    archetype: layout.archetype,
    get layout() { return layout; },
    get uniforms() { return uniforms; },
    get quality() { return state.qualityKey; },
    // Budowa synchroniczna (plan i teren na CPU, bez map GPU); gotowość = bryły
    // podpięte po rozgrzewce pipeline'ów (zadanie 11; bez haka prewarm — od razu).
    // API jak createHaloRing (ready / isReady), żeby klej gry nie rozróżniał ringów.
    get ready() { return readyPromise; },
    get isReady() { return attached; },
    get error() { return null; },

    update(dt, view) {
      const camera = view.camera;
      uniforms.uTime.value += Math.max(0, Number(dt) || 0);
      group.updateMatrixWorld();
      _inv.copy(group.matrixWorld).invert();
      camera.getWorldPosition(_camWorld);
      camLocal.copy(_camWorld).applyMatrix4(_inv);
      uniforms.uCamLocal.value.copy(camLocal);
      _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(group.matrixWorld);
      frustum.setFromProjectionMatrix(_proj);
      // górna ściana nad płaszczyzną gry (HALO_FG, jak index.js)
      const fgU = uniforms.uFgFade.value;
      if (view.gameView && layout.flightLevel !== 'roof') {
        const top = layout.z.top;
        const m = camLocal.z > top + 1 ? camLocal.z / (camLocal.z - top) : Infinity;
        const fade = (range) => {
          const k = Math.min(1, Math.max(0, (m - range[0]) / (range[1] - range[0])));
          return 1 - k * k * (3 - 2 * k);
        };
        const edge = fade(HALO_FG.troughMag) * (layout.wallHeight + 200);
        fgU.set(fade(HALO_FG.fadeMag), 1, edge, layout.radii.floorTop);
      } else {
        fgU.set(1, 0, 1e6, layout.radii.floorTop);
      }
      const pe = camera.projectionMatrix.elements[5];
      const vh = Number(view.viewportHeight) || 1080;
      const pixelAngle = camera.isPerspectiveCamera && pe > 0 ? 2 / (pe * vh) : 0;
      parts.materials.pointScale.value = vh * 0.5 * (pe > 0 ? pe : 1);
      parts.content.update?.(camLocal, frustum, pixelAngle);
      cullHalls(pixelAngle);
    },

    setSun(azimuth, elevation) {
      state.sun.azimuth = Number(azimuth) || 0;
      state.sun.elevation = Number(elevation) || 0;
      applySun();
    },

    setQuality(q) {
      const key = resolveHaloQuality(q);
      if (key === state.qualityKey) return;
      state.qualityKey = key;
      disposeParts();
      build();
    },

    rebuild(nextOptions = {}) {
      Object.assign(state.options, nextOptions);
      disposeParts();
      build();
    },

    // Wycięcie górnej ściany (jak createHaloRing.setCutaway).
    setCutaway(index, cut) {
      const A = uniforms.uCutA.value[index];
      const B = uniforms.uCutB.value[index];
      if (!A) return;
      if (!cut || !(cut.strength > 0)) { B.w = 0; return; }
      const a = Math.max(0, Number(cut.a) || 0);
      A.set(Number(cut.x) || 0, Number(cut.y) || 0, Math.cos(cut.angle || 0), Math.sin(cut.angle || 0));
      B.set(a, Math.max(0, Number(cut.b ?? a) || 0), cut.soft ?? HALO_FG.cutSoft, Math.min(1, cut.strength));
    },

    setLayers(map = {}) {
      state.layers = { ...state.layers, ...map };
      applyLayers();
    },

    setVisible() {},

    // Wysokość terenu w punkcie układu lokalnego (kolizje płyty, near kamery).
    terrainHeightAt(x, y, z) {
      let th = Math.atan2(y, x);
      if (th < 0) th += Math.PI * 2;
      return parts.content.heightAt(th, z);
    },

    get stats() {
      const c = parts.content.stats || {};
      return {
        activeTiles: 0,
        segments: 0,
        mapProgress: 1,
        mapsReady: attached,
        textureBytes: c.textureBytes || 0,
        terrainTriangles: c.triangles || 0,
        megaInstances: c.instances || 0,
        megaLights: c.lights || 0,
        shellActive: false,
        archetype: layout.archetype
      };
    },
    // mapy CPU są od razu; „gotowy do pokazania” = bryły podpięte (menu, harness: ringReady)
    get mapsReady() { return attached; },
    get k7() { return parts.k7; },
    get k7Halls() { return parts.k7Halls; },
    get k7Layout() { return state.k7Layout || null; },
    get bays() { return state.bayLayouts || []; },
    get plan() { return { landmarks: parts.content.landmarks || [], domes: parts.content.domes || [], docks: [], transits: [] }; },
    get landmarks() { return parts.content.landmarks || []; },
    get domes() { return parts.content.domes || []; },

    dispose() {
      disposeParts();
    }
  };
  return api;
}

export { archBatchMesh };
