// DZIELNICE RINGU — RING Z GRY w demie (obraz). Ziemia gry (planet3d.assets.js) i ring „Halo” Ziemi (HaloRingWorld +
// HaloRingGame) w tym samym potoku Core3D co dzielnice — wzór uruchomienia: dema/autostrada.js. Nic z gry nie jest tu
// zmieniane: ring dostaje środek i obrót przez miejsce świata (place) przed pierwszą budową, a stałe elementy portu ringu
// pod łukiem dzielnic (hale K-7 — całe, zatoki z pylonami i ich światła) chowa demo: hala przez odcięcie (obwiednia
// o ujemnym promieniu — `cullHalls` jej nie rysuje i nie aktualizuje), zatoki przez zerowy rozmiar ich instancji w planie
// megastruktury (zanim pierwszy wybór segmentów skopiuje dane do buforów). Moduły gry ładowane dopiero tu (dynamicznie),
// więc demo z ?ring=0 jest takie jak dawniej.
import { Core3D } from '../../../src/3d/core3d.js';
import { haloGameToLocal } from '../../../src/game/haloRingPlanets.js';
import { yardPoint } from './uklad.js';
import { RING_ROT, complexesInArc, earthRingLayout, ringCenter, ringFit, ringPortElements, sToTheta, thetaToS } from './ringGryUklad.js';

export { RING_ROT, ringFit, ringPortElements, sToTheta, thetaToS };

const STRIDE_INST = 12;     // HALO_INSTANCE_STRIDE: seg, wzdłuż, r − floorMid, z, sx, sy, sz, mat, q×4
const STRIDE_LIGHT = 8;     // HALO_LIGHT_STRIDE: seg, wzdłuż, r − floorMid, z, rozmiar, faza, barwa, tryb

/**
 * Ring Ziemi z gry wokół złożenia dzielnic.
 * @param {object} o
 * @param {{x:number,y:number}} o.P0 początek układu dema (krawędź ścian w osi wjazdu, świat gry)
 * @param {number} o.arcMin, o.arcMax łuk zajęty przez złożenie (s dema, z drogą) — tam znikają elementy portu ringu
 * @param {boolean} [o.showPort=false] true — zostaw port ringu pod dzielnicami (porównanie)
 * @param {string} [o.quality='high']
 * @param {object|null} [o.industry] strefa przemysłowa na podłodze habitatu pod łukiem [industry.s0, industry.s1] (s dema):
 *   opcja ringu `floorSites` (haloRingConfig.js) — pas fabryczny i osady wokół pasu przy płaszczyźnie gry (stopy pylonów),
 *   bez megabudowli i kopuł na nim; null — ring jak w grze
 */
export const RING_INDUSTRY = Object.freeze({ zMin: -500, zMax: 500, zoneInd: 1600, zoneRes: 3000 });
export async function createGameRing({ P0, arcMin, arcMax, showPort = false, quality = 'high', sun, industry = null }) {
  const [{ HaloRingWorld }, { HaloRingGame }, { buildSystemMap }, { BELT_DEFINITIONS, getOutermostBeltEdgeAu }, { DEFAULT_PLANET_SCALE }] = await Promise.all([
    import('../../../src/game/haloRingWorld.js'),
    import('../../../src/3d/haloRing/haloRingGame.js'),
    import('../../../src/data/systemMap.js'),
    import('../../../src/data/asteroidTypes.js'),
    import('../../../src/config/constants.js'),
    import('../../../src/3d/planet3d.assets.js')
  ]);
  const center = ringCenter(P0);
  // Ziemia z mapy układu gry (pola jak w grze), postawiona w środku ringu dema.
  const belt = getOutermostBeltEdgeAu(BELT_DEFINITIONS);
  const { planets, auInWorldUnits } = buildSystemMap(belt, { planetScale: DEFAULT_PLANET_SCALE, sunRadius: sun?.r || 2600 });
  if (!window.WORLD_UNITS_PER_AU) window.WORLD_UNITS_PER_AU = auInWorldUnits;
  if (!window.AU_IN_WORLD_UNITS) window.AU_IN_WORLD_UNITS = auInWorldUnits;
  const earth = planets.find((q) => q.id === 'earth');
  if (earth.baseR == null) earth.baseR = earth.r;
  earth.x = center.x;
  earth.y = center.y;
  earth.label = 'Ziemia';
  window.planets = [earth];
  // Bez słońca gry (DirectSun dokłada światła sceny — zmieniłyby klucze materiałów dema); Ziemia i ring biorą
  // kierunek słońca z window.SUN dema.
  window.initPlanets3D([earth], null);

  const world = new HaloRingWorld({ planets: [earth] });
  const entry = world.entries[0];
  // Obrót ringu: kompleks 0 portu Ziemi w osi wjazdu dema (miejsce jest wspólne dla kolidera, świata i obrazu).
  const place = entry.place;
  place.rot = RING_ROT;
  place.cos = Math.cos(RING_ROT);
  place.sin = Math.sin(RING_ROT);
  const floorSites = industry ? [{ theta0: sToTheta(industry.s0), theta1: sToTheta(industry.s1), ...RING_INDUSTRY }] : null;
  const rings = new HaloRingGame({ world, quality, ringOptions: floorSites ? { earth: { floorSites } } : null });
  const ring = rings.showcaseRing('earth');

  const layout = earthRingLayout();
  const elements = ringPortElements(layout);
  const hiddenComplexes = showPort ? new Set() : complexesInArc(elements, arcMin, arcMax);
  const hidden = { halls: [], docks: [], instances: 0, lights: 0 };
  let built = false;

  ring.ready.then((ok) => {
    if (!ok) return;
    built = true;
    if (!hiddenComplexes.size) return;
    // hale K-7: obwiednia o ujemnym promieniu — cullHalls ich nie rysuje (i obraz gry ich nie aktualizuje)
    ring.k7Halls.forEach((hall, i) => {
      if (!hiddenComplexes.has(i)) return;
      hall.bounds.r = -1;
      hall.root.visible = false;
      hidden.halls.push(i);
    });
    // zatoki (bryły w zestawie punktów orientacyjnych megastruktury) i ich światła: rozmiar 0
    const plan = ring.plan;
    const fm = layout.radii.floorMid;
    const ranges = [];
    for (const d of plan.docks) {
      if (!hiddenComplexes.has(d.complex)) continue;
      hidden.docks.push(d.id);
      ranges.push([d.theta, (d.length * 0.5 + 900) / fm]);
    }
    const hit = (seg, along, rRel) => {
      if (rRel < -120) return false;            // kadłub i tranzyty — nie
      const th = seg * plan.segAngle + along / fm;
      for (const [t, h] of ranges) {
        let d = th - t;
        d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
        if (Math.abs(d) < h) return true;
      }
      return false;
    };
    for (const p of plan.prims) {
      const a = p.landmark.data;
      for (let o = 0; o < a.length; o += STRIDE_INST) {
        if (!hit(a[o], a[o + 1], a[o + 2])) continue;
        a[o + 4] = a[o + 5] = a[o + 6] = 0;
        hidden.instances++;
      }
    }
    const L = plan.landmarkLights.data;
    for (let o = 0; o < L.length; o += STRIDE_LIGHT) {
      if (!hit(L[o], L[o + 1], L[o + 2])) continue;
      L[o + 4] = 0;
      hidden.lights++;
    }
  });

  // Wycięcia dachu ringu (górna ściana nad płaszczyzną gry) — w grze robi je statek gracza; tu znaczniki (przelot
  // tranzytu widać z góry). cuts: [{ s, v, a, b }] w układzie dema; dwa najbliższe kamery idą do slotów 0 i 1.
  let cuts = [];
  const _loc = {};
  const _cut = { x: 0, y: 0, angle: 0, a: 0, b: 0, strength: 1 };
  function applyCuts(cam) {
    if (!cuts.length) return;
    const order = cuts.map((c) => {
      const [x, z] = yardPoint(c.s, c.v);
      const gx = P0.x + x;
      const gy = P0.y + z;
      return { c, gx, gy, d: Math.hypot(gx - (Number(cam?.x) || 0), gy - (Number(cam?.y) || 0)) };
    }).sort((p, q) => p.d - q.d);
    for (let i = 0; i < 2; i++) {
      const o = order[i];
      if (!o) { ring.setCutaway(i, null); continue; }
      haloGameToLocal(place, o.gx, o.gy, _loc);
      _cut.x = _loc.x;
      _cut.y = _loc.y;
      _cut.angle = Math.atan2(_loc.y, _loc.x) + Math.PI / 2;
      _cut.a = o.c.a;
      _cut.b = o.c.b;
      ring.setCutaway(i, _cut);
    }
  }

  let on = true;
  function hideAll() {
    ring.group.visible = false;
    Core3D.removeShaftRingOccluder?.(`halo:earth`);
    for (const e of window._entities || []) if (e.group) e.group.visible = false;
  }

  return {
    world, rings, ring, earth, center, layout, elements, hiddenComplexes, hidden,
    get on() { return on; },
    /** Ring zbudowany (bryły podpięte, pełna mapa dopieczona). */
    get ready() { return built && ring.mapsReady; },
    setOn(v) { on = !!v; if (!on) hideAll(); },
    /** Raz na klatkę, przed Core3D.render: kamera TEJ klatki (gra: { x, y, zoom }; kino: free3d). */
    frame(dt, cam, gameDt = dt) {
      if (!on) {
        // maska cieni: bez tarczy planety i okręgu ringu (lista tarcz zerowana co klatkę)
        Core3D.beginShaftDiscFrame?.();
        Core3D.beginPlanetLayerFrame?.();
        return;
      }
      if (Core3D.isFreePerspectiveCamera(cam)) Core3D.syncCamera(cam);
      window.updatePlanets3D(gameDt, cam);
      world.frame({ nowMs: performance.now(), gameDt, frameDt: dt, ship: null, sun: window.SUN });
      rings.update(dt, cam, { sun: window.SUN, ship: null, gameDt, quality, splitScreen: false });
      applyCuts(cam);
    },
    /** Wycięcia dachu ringu nad miejscami dema ([{ s, v, a, b }], a — wzdłuż łuku, b — promieniowo); [] — bez. */
    setCuts(list) { cuts = Array.isArray(list) ? list : []; if (!cuts.length) { ring.setCutaway(0, null); ring.setCutaway(1, null); } },
    /** Stałe elementy ringu (s dema) z dzielnicą, pod którą leżą: parts [{ id, sMin, sMax }]. */
    report(parts) {
      const at = (s) => parts.find((p) => s >= p.sMin && s <= p.sMax)?.id || null;
      const over = (a, b) => parts.filter((p) => b > p.sMin && a < p.sMax).map((p) => p.id);
      const row = (e) => ({ id: e.id, kind: e.kind, s: Math.round(e.s), s0: Math.round(e.s0), s1: Math.round(e.s1), under: over(e.s0, e.s1).join(', ') || 'droga za dzielnicami',
        hidden: e.complex >= 0 && hiddenComplexes.has(e.complex) });
      const civic = [];
      for (const d of ring.domes || []) civic.push({ id: `kopuła ${d.type || d.typeIndex || ''}`.trim(), kind: 'kopuła', s: thetaToS(d.theta) });
      for (const m of ring.landmarks || []) civic.push({ id: m.name || 'megabudowla', kind: 'megabudowla', s: thetaToS(m.theta) });
      return {
        fit: ringFit(layout),
        rot: RING_ROT,
        elements: elements.filter((e) => e.s1 > arcMin && e.s0 < arcMax).map(row),
        civic: civic.filter((c) => c.s > arcMin && c.s < arcMax).map((c) => ({ ...c, s: Math.round(c.s), under: at(c.s) })),
        hidden: { ...hidden, complexes: [...hiddenComplexes] },
        stats: { ...rings.stats, ring: ring.stats }
      };
    }
  };
}
