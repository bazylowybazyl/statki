// Ring „Halo” w grze (port do gry 2026-09-25): klej między grą (świat 2D,
// Core3D) a modułem ringu (createHaloRing). Opis: docs/PORT-halo-ring.md.
//
//  - ring Ziemi i Marsa (ta sama bryła, promień planety i ziarno z
//    src/game/haloRingPlanets.js): grupa w środku planety, obrócona tak, żeby
//    port leżał pod kątem dawnej stacji; tworzony leniwie, gdy kadr się zbliży;
//  - BG (warstwa 1, pod statkami), górna ściana z dachem i suwnice K-7 w FG
//    (warstwa 2) — kolejność passów Core3D;
//  - kamera: replika kamery perspektywicznej passów Core3D (syncCamera) na TĘ
//    klatkę i z tym samym rozmiarem bufora — ring liczy pozycje względem kamery
//    (RTE), więc kamera z poprzedniej klatki przesuwałaby go względem sceny;
//  - słońce: azymut do Słońca gry + wysokość 49° (jak DirectionalLight gry);
//  - wycięcie górnej ściany nad graczem i zanik dachów hal K-7 (jak w demie
//    lotu, dema/halo_ring_k7_flight.js);
//  - okluder smug cieni (Core3D.setShaftRingOccluder) i jakość z ustawień gry
//    (OPTIONS.planetQuality: low / medium / high / ultra);
//  - kolizje: HaloRingCollider (płyta + ściany portu) z terenem z mapy ringu.
// Zero alokacji na klatkę (bufory i obiekty wycięć wielokrotnego użytku).
import * as THREE from 'three';
import { Core3D } from '../core3d.js';
import { createHaloRing } from './index.js';
import { resolveHaloQuality } from './haloRingConfig.js';
import { K7RoofFade, k7HubToWorld } from './haloPortK7Layout.js';
import { haloXfPoint } from './haloPortBays.js';
import { resolveRingPlanetWorldRadius } from '../ringScale.js';
import { HALO_RING_PLANETS, haloGameToLocal, haloRingKey } from '../../game/haloRingPlanets.js';
import { HaloRingCollider } from '../../game/haloRingCollision.js';

export const HALO_GAME = Object.freeze({
  layers: Object.freeze({ default: 1, fg: 2 }),
  sunElevationDeg: 49,
  activateDistance: 420000,   // ring powstaje, gdy środek kadru jest bliżej planety
  hallReach: 9000,            // hale K-7 wystają za krawędź ścian (płyta przed G-01)
  viewMargin: 14000,          // zapas kadru: perspektywa górnej ściany nad płaszczyzną gry
  cutRadiusMin: 1350,         // wycięcie górnej ściany nad statkiem
  occluderReachMul: 1.15,     // zasięg cienia ringu w smugach (jak dawny ring)
  fadeHallRange: 16000,       // zanik dachów tylko przy halach / zatokach w pobliżu statku
  fadeBayRange: 9000
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function footprintHub(owner) {
  const q = {};
  return owner.layout.footprint.map(([x, z]) => {
    haloXfPoint(owner.xf, x, z, q);
    return { x: q.x, z: q.z };
  });
}

export class HaloRingGame {
  constructor({ planets = [], quality = 'high', renderer = null, scene = null } = {}) {
    this.renderer = renderer || Core3D.renderer;
    this.scene = scene || Core3D.scene;
    this.qualityKey = resolveHaloQuality(quality);
    this.camera = new THREE.PerspectiveCamera(35, 1, 100, 500000);
    this.camera.up.set(0, 1, 0);
    this.entries = [];
    this._local = { x: 0, y: 0 };
    this._hubC = { x: 0, y: 0 };
    this._cut0 = { x: 0, y: 0, angle: 0, a: 0, b: 0, strength: 0 };
    this._cut1 = { x: 0, y: 0, angle: 0, a: 0, b: 0, strength: 0 };
    this._hallOpts = { poses: null, roofFade: 0, daylight: 1 };
    this.stats = { rings: 0, visible: 0, updateMs: 0 };
    this.setPlanets(planets);
  }

  // Planety z ringiem (Ziemia, Mars) — kolidery od razu, render leniwie.
  setPlanets(planets) {
    for (const planet of planets || []) {
      const key = haloRingKey(planet);
      if (!key || this.entries.some((e) => e.key === key)) continue;
      const collider = new HaloRingCollider(planet);
      const reg = collider.registry;
      this.entries.push({
        key,
        planet,
        collider,
        place: collider.place,
        ring: null,
        visible: false,
        sunAz: NaN,
        hallFades: reg.halls.map((o) => new K7RoofFade(footprintHub(o))),
        bayFades: reg.bays.map((o) => new K7RoofFade(footprintHub(o))),
        hallFade: 0,
        hallIndex: -1,
        bayFade: 0,
        bayIndex: -1,
        occluderKey: `halo:${key}`
      });
    }
  }

  ringOf(key) {
    return this.entries.find((e) => e.key === key)?.ring || null;
  }

  _ensureRing(e) {
    if (e.ring) return e.ring;
    const ring = createHaloRing({
      planetRadius: resolveRingPlanetWorldRadius(e.planet),
      seed: HALO_RING_PLANETS[e.key].seed,
      quality: this.qualityKey,
      renderer: this.renderer
    });
    ring.setLayers(HALO_GAME.layers);
    ring.group.rotation.z = e.place.rot;
    ring.group.position.set(e.place.x, -e.place.y, 0);
    ring.group.visible = false;
    this.scene.add(ring.group);
    e.ring = ring;
    e.sunAz = NaN;
    // stanowiska wolne: statków ruchu jeszcze nie ma (ring nie udaje życia),
    // dokowanie gracza w hali K-7 przyjdzie z automatem portu
    for (const hall of ring.k7Halls) {
      for (const b of hall.layout.berths) { b.occupied = null; b.reserved = null; }
      for (const lane of hall.layout.lanes || []) lane.reserved = null;
      hall.setBerthLamps();
    }
    e.collider.setTerrain((lx, ly) => ring.terrainHeightAt(lx, ly, 0));
    this.stats.rings = this.entries.filter((v) => v.ring).length;
    return ring;
  }

  setQuality(q) {
    const key = resolveHaloQuality(q);
    if (key === this.qualityKey) return;
    this.qualityKey = key;
    for (const e of this.entries) {
      if (!e.ring) continue;
      e.ring.setQuality(key);
      e.sunAz = NaN;
    }
  }

  // Kamera persp passów Core3D (syncCamera): FOV 35°, wysokość z rozmiaru
  // bufora sceny i zoomu, patrzy pionowo w dół na (x, −y, 0).
  _syncCamera(x, y, zoom, vw, vh) {
    const cam = this.camera;
    const src = Core3D.cameraPersp;
    cam.fov = src?.fov || 35;
    cam.near = src?.near || 100;
    cam.far = src?.far || 500000;
    cam.aspect = vw / Math.max(1, vh);
    cam.updateProjectionMatrix();
    const h = (vh * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) / zoom;
    cam.position.set(x, -y, h);
    cam.lookAt(x, -y, 0);
    cam.updateMatrixWorld(true);
  }

  // Raz na klatkę renderu, przed Core3D.render. cam — kamera gry tej klatki
  // (x, y, zoom, z wstrząsem — ta sama, którą dostają passy), opts: sun
  // (Słońce gry), ship (gracz: wycięcia, dachy hal), quality, splitScreen.
  update(dt, cam, opts = {}) {
    const t0 = performance.now();
    if (opts.quality) this.setQuality(opts.quality);
    const target = Core3D.composerTarget;
    const vw = target?.width || this.renderer?.domElement?.width || 1920;
    const vh = target?.height || this.renderer?.domElement?.height || 1080;
    const zoom = Math.max(0.0001, Number(cam?.zoom) || 1);
    const cx = Number(cam?.x) || 0;
    const cy = Number(cam?.y) || 0;
    this._syncCamera(cx, cy, zoom, vw, vh);
    const halfW = (vw * 0.5) / zoom;
    const halfH = (vh * 0.5) / zoom;
    let visible = 0;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.collider.setPlanet(e.planet);
      const L = e.collider.layout;
      const dx = e.place.x - cx;
      const dy = e.place.y - cy;
      // cień ringu w smugach — analityczny okrąg, także gdy ring poza kadrem
      const ringMid = (L.radii.min + L.radii.max) * 0.5;
      Core3D.setShaftRingOccluder?.(e.occluderKey, e.place.x, e.place.y, ringMid, ringMid * HALO_GAME.occluderReachMul);
      if (!e.ring && Math.hypot(dx, dy) < HALO_GAME.activateDistance) this._ensureRing(e);
      const ring = e.ring;
      if (!ring) continue;
      // podzielony ekran: ring liczy RTE dla jednej kamery — drugi kadr by go przesunął
      const reach = L.radii.max + HALO_GAME.hallReach + HALO_GAME.viewMargin;
      const inView = !opts.splitScreen && Math.abs(dx) < halfW + reach && Math.abs(dy) < halfH + reach;
      ring.group.visible = inView;
      e.visible = inView;
      if (!inView) continue;
      visible++;
      ring.group.position.set(e.place.x, -e.place.y, 0);
      ring.update(dt, { camera: this.camera, viewportHeight: vh, gameView: true });
      this._applySun(e, opts.sun);
      this._portVisuals(e, dt, opts.ship || null);
    }
    this.stats.visible = visible;
    this.stats.updateMs = performance.now() - t0;
  }

  _applySun(e, sun) {
    const sx = Number(sun?.x);
    const sy = Number(sun?.y);
    const world = Number.isFinite(sx) && Number.isFinite(sy) ? Math.atan2(-(sy - e.place.y), sx - e.place.x) : 0;
    const local = world - e.place.rot;
    if (Math.abs(local - e.sunAz) < 1e-6) return;
    e.ring.setSun(local, HALO_GAME.sunElevationDeg * Math.PI / 180);
    e.sunAz = local;
  }

  // Światło dnia w punkcie ringu (cień planety) — lampy hal K-7 nocą.
  _daylight(e, x, y) {
    const ring = e.ring;
    const L = ring.layout;
    const s = ring.uniforms.uSunDir.value;
    const oz = -L.planetCenterZ;
    const t = -(x * s.x + y * s.y + oz * s.z);
    if (t <= 0) return 1;
    const d = Math.sqrt(Math.max(0, x * x + y * y + oz * oz - t * t));
    const R = L.planetRadius;
    const k = clamp01((d - (R - 500)) / 1300);
    return k * k * (3 - 2 * k);
  }

  // Zanik dachów hal K-7 (statek w hali), wycięcia górnej ściany, lampy hal.
  _portVisuals(e, dt, ship) {
    const ring = e.ring;
    const reg = e.collider.registry;
    const alive = ship && !ship.dead && ship.pos;
    const hull = alive ? e.collider.hubOutline(ship) : null;
    let hx = 0;
    let hz = 0;
    if (hull) {
      for (let i = 0; i < hull.length; i++) { hx += hull[i].x; hz += hull[i].z; }
      hx /= hull.length;
      hz /= hull.length;
    }
    e.hallFade = 0;
    e.hallIndex = -1;
    e.bayFade = 0;
    e.bayIndex = -1;
    for (let i = 0; i < e.hallFades.length; i++) {
      const f = e.hallFades[i];
      const c0 = f.footprint[0];
      if (!hull || (Math.hypot(hx - c0.x, hz - c0.z) > HALO_GAME.fadeHallRange && f.fade < 0.001)) { f.fade = 0; continue; }
      f.update(hull, dt);
      if (f.fade > e.hallFade) { e.hallFade = f.fade; e.hallIndex = i; }
    }
    for (let i = 0; i < e.bayFades.length; i++) {
      const f = e.bayFades[i];
      const c0 = f.footprint[0];
      if (!hull || (Math.hypot(hx - c0.x, hz - c0.z) > HALO_GAME.fadeBayRange && f.fade < 0.001)) { f.fade = 0; continue; }
      f.update(hull, dt);
      if (f.fade > e.bayFade) { e.bayFade = f.fade; e.bayIndex = i; }
    }
    const halls = ring.k7Halls;
    for (let i = 0; i < halls.length; i++) {
      const hall = halls[i];
      if (!hall.root.visible) continue;
      const o = hall.frame.origin;
      const opts = this._hallOpts;
      opts.roofFade = e.hallFades[i]?.fade || 0;
      opts.daylight = this._daylight(e, o.x, o.y);
      hall.update(dt, opts);
    }
    if (!alive) {
      ring.setCutaway(0, null);
      ring.setCutaway(1, null);
      return;
    }
    // wycięcie nad halą (gdy jej dach znika) albo nad zatoką, w której jest statek
    const inHall = e.hallFade >= e.bayFade && e.hallIndex >= 0;
    if (inHall || e.bayIndex >= 0) {
      const o = inHall ? reg.halls[e.hallIndex] : reg.bays[e.bayIndex];
      const f = o.frame;
      const l = o.layout;
      const z0 = f.floorZ - 100;
      const z1 = inHall ? f.rimZ + 800 : l.openZ + 200;
      const c = k7HubToWorld(f, 0, (z0 + z1) * 0.5, this._hubC);
      const cut = this._cut0;
      cut.x = c.x;
      cut.y = c.y;
      cut.angle = Math.atan2(f.ty, f.tx);
      cut.a = (inHall ? l.halfWidth : l.halfWidth + 400) + 600;
      cut.b = (z1 - z0) * 0.5;
      cut.strength = inHall ? e.hallFade : e.bayFade;
      ring.setCutaway(0, cut);
    } else {
      ring.setCutaway(0, null);
    }
    // koło nad statkiem pod górną ścianą: wąwóz habitatu, tunel tranzytu, pas za kadłubem
    const L = ring.layout;
    const s = haloGameToLocal(e.place, ship.pos.x, ship.pos.y, this._local);
    const r = Math.hypot(s.x, s.y);
    const under = clamp01((L.radii.rim + 1300 - r) / 700) * clamp01((r - (L.radii.back - 1500)) / 700);
    const rad = Math.max(HALO_GAME.cutRadiusMin, (Number(ship.w) || 0) * 0.75);
    const cut = this._cut1;
    cut.x = s.x;
    cut.y = s.y;
    cut.angle = 0;
    cut.a = rad;
    cut.b = rad;
    cut.strength = under;
    ring.setCutaway(1, cut);
  }

  // Kolizje statku ze wszystkimi ringami (płyta; walls = ściany portu dla graczy).
  // Wynik ostatniego trafienia albo null (ringi się nie nakładają).
  constrainShip(ship, walls = false) {
    let hit = null;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.collider.setPlanet(e.planet);
      const res = e.collider.constrainShip(ship, walls);
      if (res.hit) hit = res;
    }
    return hit;
  }

  // Punkt świata gry w płycie któregoś ringu (pociski).
  pointInSlab(x, y) {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.collider.setPlanet(e.planet);
      if (e.collider.pointInSlab(x, y)) return true;
    }
    return false;
  }

  dispose() {
    for (const e of this.entries) {
      Core3D.removeShaftRingOccluder?.(e.occluderKey);
      if (!e.ring) continue;
      this.scene.remove(e.ring.group);
      e.ring.dispose();
      e.ring = null;
    }
    this.stats.rings = 0;
  }
}
