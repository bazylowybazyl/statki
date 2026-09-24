// Tryb „Lot” dema ringu: rozgrywka portu Ziemi (hale K-7 z dema ECUMENE,
// orbital_ring_gameplay_hub_v3.html, i otwarte zatoki obok nich) na nowym
// ringu. Statek lata w płaszczyźnie gry (z = 0), kamera gry podąża za nim,
// E = dokuj / oddokuj, W/S ciąg, A/D obrót, Spacja hamulec, Shift dopalacz
// (poza portem), V = zmiana kadłuba, T = skok przed tranzyt.
//
// Kadłuby jak NPC ruchu v2 (haloPortHulls.js: Atlas, megafrachtowiec, ciężki
// frachtowiec, frachtowiec dalekiego zasięgu, kontenerowiec, prom) — gracz
// dokuje na każdym stanowisku, na którym kadłub się mieści: capital hal K-7
// (suwnica, węże), grzebienie hal, pasy MEGA i grzebienie otwartych zatok
// (mocowanie magnetyczne). Automat: haloPortDocking.js; model lotu i kolizje:
// haloPortK7Layout.js. Tu klej: stały krok 120 Hz, wejście, kamera, HUD,
// sprite i kadłub statku, płomienie dysz. Statków NPC i ruchu tu nie ma —
// wdrażane osobno (2026-09-24).
//
// Hale i zatoki są wpięte w podłogę habitatu na środku wstęgi (płaszczyzna gry
// przecina ring przez środek): podłoga z terenem (góry!) i kadłub to przeszkoda
// — przez ring prowadzą tylko 4 tranzyty. Górna ściana ringu nad wąwozem
// habitatu dostaje wycięcia nad graczem (ring.setCutaway) — jak dach hali K-7.
import * as THREE from 'three';
import {
  K7FlightModel,
  K7RoofFade,
  k7HeadingToWorld,
  k7HeightToZ,
  k7HubToWorld,
  k7WorldToHub
} from '../src/3d/haloRing/haloPortK7Layout.js';
import { HALO_TRANSIT, haloTransitAngles } from '../src/3d/haloRing/haloRingConfig.js';
import { bayLaneOf, haloXfPoint } from '../src/3d/haloRing/haloPortBays.js';
import { HALO_PLAYER_HULLS, HALO_PLAYER_HULL_ORDER } from '../src/3d/haloRing/haloPortHulls.js';
import { PortDocking, buildPortCollision, createPortRegistry } from '../src/3d/haloRing/haloPortDocking.js';

const STEP = 1 / 120;
const STATES = { DOCKED: 'ZADOKOWANY', DOCKING: 'DOKOWANIE', UNDOCKING: 'ODDOKOWANIE', FREE: 'LOT RĘCZNY' };
const SIZE_RANK = { S: 0, M: 1, L: 2, CAPITAL: 3, MEGA: 4 };
// stanowisko startowe kadłuba (kompleks gracza), gdy wolne
const SPAWN = { atlas: 'C-01', heavy_freighter: 'C-02', megafreighter: 'Z02-MG2' };

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(123,207,255,0)');
  grad.addColorStop(0.32, 'rgba(66,154,213,0.1)');
  grad.addColorStop(0.8, 'rgba(145,235,255,0.6)');
  grad.addColorStop(1, 'rgba(237,254,255,1)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, 32);
  g.quadraticCurveTo(100, 28, 256, 8);
  g.lineTo(256, 56);
  g.quadraticCurveTo(100, 36, 0, 32);
  g.fill();
  return new THREE.CanvasTexture(c);
}

// Kadłub pod sprite'em do kamery kinowej: wytłoczona obwiednia (ciemna burta)
// — w kamerze gry widać ją tylko jako lekką grubość przy brzegach.
function hullGeometry(hull) {
  const shape = new THREE.Shape();
  hull.outline.forEach(([u, v], i) => {
    const x = u * hull.w;
    const y = v * hull.h;
    if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
  });
  const depth = -k7HeightToZ(48) * Math.min(1, Math.max(0.35, hull.h / 806));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth - 1);
  return g;
}

export class K7FlightDemo {
  constructor({ ring, scene, atlas, layers, $, loadTexture = null, daylightAt = null }) {
    this.ring = ring;
    this.$ = $;
    this.atlas = atlas;
    this.loadTexture = loadTexture;
    this.daylightAt = daylightAt;
    this.textures = new Map();
    this.layout = ring.k7Layout;
    this.frame = ring.k7.frame;
    this.transitAngles = haloTransitAngles();
    this.registry = createPortRegistry({
      halls: ring.k7Halls.map((h) => ({ index: h.index, frame: h.frame, layout: h.layout })),
      bays: ring.bays,
      frame: this.frame
    });
    this.collision = buildPortCollision({ registry: this.registry, frame: this.frame, ringLayout: ring.layout });
    // czynnik „w porcie” (niższe limity lotu) i zanik dachu hal
    this.hallFades = this.registry.halls.map((o) => new K7RoofFade(this._footprintHub(o)));
    this.bayFades = this.registry.bays.map((o) => new K7RoofFade(this._footprintHub(o)));
    this.roof = { fade: 0 };
    this.inside = 0;
    this.accumulator = 0;
    this.active = false;
    this.keys = null;
    this.camTarget = new THREE.Vector2();
    this.camInit = false;
    this._w = {};
    this._h = {};
    this._q = {};
    this.shipWorld = { x: 0, y: 0, heading: 0 };
    // kadłub pod sprite'em + płomienie dysz (świat ortho jak statki gry)
    this.hull = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x0b1116 }));
    this.hull.layers.set(layers.bg);
    this.hull.frustumCulled = false;
    scene.add(this.hull);
    const tex = flameTexture();
    this.flames = Array.from({ length: 4 }, () => {
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x9fe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(390, 64), mat);
      mesh.layers.set(layers.world);
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    });
    this.hullId = 'atlas';
    // sprite'y wszystkich kadłubów od razu (bez pustej klatki przy zmianie kadłuba)
    if (this.loadTexture) {
      for (const h of Object.values(HALO_PLAYER_HULLS)) {
        if (h.id !== 'atlas' && !this.textures.has(h.sprite)) this.textures.set(h.sprite, this.loadTexture(h.sprite));
      }
    }
    this.reset('docked');
    this._bindHud();
  }

  // ---- świat kolizji (układ huba hali gracza): hale, zatoki, tranzyty —
  // buildPortCollision (haloPortDocking.js). Statków NPC ring nie udaje.
  _footprintHub(o) {
    const q = {};
    return o.layout.footprint.map(([x, z]) => { haloXfPoint(o.xf, x, z, q); return { x: q.x, z: q.z }; });
  }

  // Środek punktu w korytarzu tranzytu (płyta przecięta tunelem)?
  _inTransit(wx, wy) {
    const th = Math.atan2(wy, wx);
    const R = this.ring.layout.radii.floorMid;
    const half = HALO_TRANSIT.halfWidth + HALO_TRANSIT.wall;
    for (const a of this.transitAngles) {
      let d = th - a;
      d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
      if (Math.abs(d) * R < half) return true;
    }
    return false;
  }

  // ---- kadłub gracza --------------------------------------------------------
  get hullSpec() { return HALO_PLAYER_HULLS[this.hullId]; }

  setHull(id, mode = 'docked') {
    if (!HALO_PLAYER_HULLS[id]) return this.hullId;
    this.hullId = id;
    this.reset(mode);
    this.notice(`KADŁUB: ${this.hullSpec.name.toUpperCase()} / KLASA ${this.hullSpec.cls}`);
    return id;
  }

  cycleHull() {
    const i = HALO_PLAYER_HULL_ORDER.indexOf(this.hullId);
    return this.setHull(HALO_PLAYER_HULL_ORDER[(i + 1) % HALO_PLAYER_HULL_ORDER.length], this.docking?.state === 'FREE' ? 'free' : 'docked');
  }

  _applyHullVisual() {
    const h = this.hullSpec;
    if (this.atlas) {
      this.atlas.scale.set(h.w / 1800, h.h / 806, 1);
      if (this.loadTexture && h.id !== 'atlas') {
        if (!this.textures.has(h.sprite)) this.textures.set(h.sprite, this.loadTexture(h.sprite));
        if (!this._atlasMap) this._atlasMap = this.atlas.material.map;
        this.atlas.material.map = this.textures.get(h.sprite);
      } else if (this._atlasMap) {
        this.atlas.material.map = this._atlasMap;
      }
      this.atlas.material.needsUpdate = true;
    }
    this.hull.geometry.dispose();
    this.hull.geometry = hullGeometry(h);
  }

  // Stanowisko startowe kadłuba w kompleksie gracza: wskazane w SPAWN albo
  // najmniejsze wolne pasujące (zatoki przed halą, zatoka Z-02 przed innymi).
  _spawnEntry() {
    const h = this.hullSpec;
    const d = this.docking;
    const pick = SPAWN[h.id];
    const all = this.registry.entries.filter((e) => e.complex === 0 && d.fits(e) && !d.taken(e.berth));
    const named = all.find((e) => e.label === pick);
    if (named) return named;
    const score = (e) => SIZE_RANK[e.berth.size] * 10 + (e.kind === 'bay' ? 0 : 5) + (e.owner.layout.id === 'Z-02' ? 0 : 1);
    all.sort((a, b) => score(a) - score(b));
    return all[0] || null;
  }

  // Pozycja przed stanowiskiem (lot ręczny): capital K-7 na pasie przed G-01,
  // grzebienie K-7 przed bramą boczną, pas MEGA i aleja zatoki nad wylotem.
  _approachPose(e) {
    const b = e.berth;
    const l = e.owner.layout;
    const h = this.hullSpec;
    let x;
    let z;
    let angle = -Math.PI / 2;
    if (e.kind === 'k7') {
      if (b.size === 'CAPITAL') { x = b.x; z = l.frontZ + l.apronDepth - 150; } else {
        const g = l.gates.find((v) => v.id === (b.side < 0 ? 'G-03' : 'G-02'));
        x = g.x + g.nx * (600 + h.w * 0.5);
        z = g.z + g.nz * (600 + h.w * 0.5);
        angle = Math.atan2(-g.nz, -g.nx);
      }
    } else if (b.size === 'MEGA') { x = bayLaneOf(l, b).x; z = l.openZ + 300 + h.w * 0.5; } else { x = l.aisle.x; z = l.openZ + 250 + h.w * 0.5; }
    const q = haloXfPoint(e.owner.xf, x, z, {});
    return { x: q.x, z: q.z, angle: angle + e.owner.xf.phi };
  }

  // stan startowy do zrzutów: 'docked' | 'free' (przed stanowiskiem startowym)
  reset(mode = 'docked') {
    for (const e of this.registry.entries) {
      const b = e.berth;
      if (b.occupied === 'player') b.occupied = null;
      if (b.reserved === 'player') b.reserved = null;
    }
    for (const o of this.registry.owners) {
      for (const lane of o.layout.lanes || []) if (lane.reserved === 'player') lane.reserved = null;
      if (o.poses) for (const pose of o.poses.values()) Object.assign(pose, { bridge: 0, trolley: 0, lower: 0, clamp: 0, extension: 0, lock: 0, flow: 0, vent: 0 });
    }
    const h = this.hullSpec;
    this.player = new K7FlightModel(this.collision, { x: 0, z: 0, angle: 0 }, { w: h.w, h: h.h }, h.outline, h.tune);
    this.player.onNotice = (t) => this.notice(t);
    this.docking = new PortDocking(this.registry, this.player, h);
    this.docking.onNotice = (t) => this.notice(t);
    const e = this._spawnEntry();
    if (e && mode !== 'free') this.docking.dockAt(e);
    else if (e) {
      const pose = this._approachPose(e);
      this.player.x = pose.x;
      this.player.z = pose.z;
      this.player.angle = pose.angle;
      this.player.locked = false;
    }
    this.spawn = e;
    this._applyHullVisual();
    this._updateFades(0, true);
    this.camInit = false;
  }

  // Skok przed stanowisko (etykieta, np. 'Z02-M02' albo 'K7-2 C-03') — zrzuty, testy.
  jumpToBerth(label) {
    const e = this.registry.entries.find((v) => v.label === label);
    if (!e) return false;
    if (this.docking.state !== 'FREE') this.reset('free');
    const pose = this._approachPose(e);
    const p = this.player;
    p.x = pose.x; p.z = pose.z; p.angle = pose.angle;
    p.vx = p.vz = p.angVel = 0;
    p.locked = false;
    this.camInit = false;
    this._updateFades(0, true);
    return true;
  }

  // Ustawienie na polu STOP stanowiska (dziobem do stanowiska, bez prędkości) — testy.
  placeOnBerth(label) {
    const e = this.registry.entries.find((v) => v.label === label);
    if (!e) return false;
    if (this.docking.state !== 'FREE') this.reset('free');
    const p = this.player;
    p.x = e.x; p.z = e.z; p.angle = e.angle;
    p.vx = p.vz = p.angVel = 0;
    p.locked = false;
    this.camInit = false;
    this._updateFades(0, true);
    return true;
  }

  // Skok przed wylot najbliższego tranzytu (strona habitatu), dziobem do tunelu.
  jumpToTransit() {
    const f = this.frame;
    const p0 = this.player;
    const w = k7HubToWorld(f, p0.x, p0.z, {});
    const th = Math.atan2(w.y, w.x);
    let best = this.transitAngles[0];
    let bd = Infinity;
    for (const a of this.transitAngles) {
      let d = a - th;
      d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
      if (Math.abs(d) < bd) { bd = Math.abs(d); best = a; }
    }
    if (this.docking.state !== 'FREE') this.reset('free');
    const r = f.floorR + 1500 + this.hullSpec.w * 0.4;
    const hub = k7WorldToHub(f, Math.cos(best) * r, Math.sin(best) * r, {});
    const dx = -Math.cos(best);
    const dy = -Math.sin(best);
    const p = this.player;
    p.x = hub.x;
    p.z = hub.z;
    p.angle = Math.atan2(dx * f.rx + dy * f.ry, dx * f.tx + dy * f.ty);
    p.vx = 0; p.vz = 0; p.angVel = 0;
    this.camInit = false;
    const idx = this.transitAngles.indexOf(best);
    this.notice(`Tranzyt T-${String(idx + 1).padStart(2, '0')}: wlot przed dziobem — W: przelot na stronę planety.`);
    return idx;
  }

  // Podłoga z terenem (góry, pas fabryczny, płyty portu) i kadłub ringu:
  // wierzchołki kadłuba nie wchodzą w płytę [kadłub ringu, teren] — dopychanie
  // promieniowe na stronę środka statku (habitat albo planeta), bez odbicia.
  // Tunel tranzytu otwiera płytę (wierzchołki w korytarzu pomijane).
  _groundConstraint() {
    const p = this.player;
    const f = this.frame;
    const L = this.ring.layout;
    const back = L.radii.back;
    const fm = L.radii.floorMid;
    const c = k7HubToWorld(f, p.x, p.z, this._w);
    const rc = Math.hypot(c.x, c.y);
    const habitat = rc > (back + fm) * 0.5;
    const poly = p.polygon();
    let push = 0;
    for (let i = 0; i < poly.length; i++) {
      const w = k7HubToWorld(f, poly[i].x, poly[i].z, this._h);
      const r = Math.hypot(w.x, w.y);
      if (r > fm + 1400 || r < back - 400) continue;
      if (this._inTransit(w.x, w.y)) continue;
      if (habitat) {
        const g = fm + Math.max(7, this.ring.terrainHeightAt(w.x, w.y, 0) || 0) + 14;
        if (r < g && g - r > push) push = g - r;
      } else {
        const g = back - 14;
        if (r > g && g - r < push) push = g - r;
      }
    }
    if (push === 0) return;
    const ux = c.x / rc;
    const uy = c.y / rc;
    const hub = k7WorldToHub(f, c.x + ux * push, c.y + uy * push, this._h);
    p.x = hub.x;
    p.z = hub.z;
    // prędkość w głąb płyty (składowa promieniowa w układzie huba) zerowana
    const rx = ux * f.tx + uy * f.ty;
    const rz = ux * f.rx + uy * f.ry;
    const vr = p.vx * rx + p.vz * rz;
    if (push > 0 ? vr < 0 : vr > 0) { p.vx -= vr * rx; p.vz -= vr * rz; }
  }

  // Zanik dachów hal i czynnik „w porcie” (hale i zatoki) — tylko w pobliżu statku.
  _updateFades(dt, instant = false) {
    const hull = this.player.polygon();
    const p = this.player;
    let inside = 0;
    let roof = 0;
    this.hallIndex = -1;
    this.bayIndex = -1;
    this.registry.halls.forEach((o, i) => {
      const f = this.hallFades[i];
      const c = f.footprint[0];
      if (Math.hypot(p.x - c.x, p.z - c.z) > 16000 && f.fade < 0.001) { f.fade = 0; return; }
      f.update(hull, dt, instant);
      if (f.fade > roof) { roof = f.fade; this.hallIndex = i; }
    });
    let bayIn = 0;
    this.registry.bays.forEach((o, i) => {
      const f = this.bayFades[i];
      const c = f.footprint[0];
      if (Math.hypot(p.x - c.x, p.z - c.z) > 9000 && f.fade < 0.001) { f.fade = 0; return; }
      f.update(hull, dt, instant);
      if (f.fade > bayIn) { bayIn = f.fade; this.bayIndex = i; }
    });
    inside = Math.max(roof, bayIn);
    this.roof.fade = roof;
    this.bayFade = bayIn;
    this.inside = inside;
  }

  // Wycięcia górnej ściany ringu (kamera gry): nad halą (gdy dach hali znika)
  // albo nad zatoką, w której jest statek, i koło nad statkiem pod górną ścianą.
  _cutaways() {
    const ring = this.ring;
    if (!ring.setCutaway) return;
    if (!this.active) { ring.setCutaway(0, null); ring.setCutaway(1, null); return; }
    const inHall = this.roof.fade >= this.bayFade && this.hallIndex >= 0;
    if (inHall || this.bayIndex >= 0) {
      const o = inHall ? this.registry.halls[this.hallIndex] : this.registry.bays[this.bayIndex];
      const f = o.frame;
      const l = o.layout;
      const z0 = f.floorZ - 100;
      const z1 = inHall ? f.rimZ + 800 : l.openZ + 200;
      const half = (inHall ? l.halfWidth : l.halfWidth + 400) + 600;
      const c = k7HubToWorld(f, 0, (z0 + z1) * 0.5, this._h);
      ring.setCutaway(0, { x: c.x, y: c.y, angle: Math.atan2(f.ty, f.tx), a: half, b: (z1 - z0) * 0.5, strength: inHall ? this.roof.fade : this.bayFade });
    } else ring.setCutaway(0, null);
    const s = this.shipWorld;
    const r = Math.hypot(s.x, s.y);
    const rim = ring.layout.radii.rim;
    const back = ring.layout.radii.back;
    // pod górną ścianą: wąwóz habitatu, tunel tranzytu i pas tuż za kadłubem
    const under = Math.min(1, Math.max(0, (rim + 1300 - r) / 700)) * Math.min(1, Math.max(0, (r - (back - 1500)) / 700));
    const rad = Math.max(1350, this.hullSpec.w * 0.75);
    ring.setCutaway(1, { x: s.x, y: s.y, a: rad, b: rad, strength: under });
  }

  _bindHud() {
    const btn = this.$('k7-action');
    if (btn) btn.addEventListener('click', () => this.docking.action());
  }

  notice(text) {
    const el = this.$('k7-notice');
    if (!el) return;
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => { el.style.opacity = 0; }, 3400);
  }

  setActive(on) {
    this.active = on;
    this.$('k7-hud')?.classList.toggle('on', on);
    if (on) this.camInit = false;
    this._cutaways();
  }

  action() { return this.docking.action(); }

  // Stały krok 120 Hz (jak K-7), maks. 14 kroków na klatkę.
  update(dt, keys) {
    const p = this.player;
    if (this.active && keys) {
      const input = p.input;
      input.main = keys.has('KeyW') ? 1 : 0;
      input.retro = keys.has('KeyS') ? 1 : 0;
      input.torque = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      input.brake = keys.has('Space') ? 1 : 0;
      input.boost = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
    }
    this.accumulator += dt;
    let n = 0;
    while (this.accumulator >= STEP && n < 14) {
      this.docking.update(STEP);
      p.step(STEP, this.inside);
      this._groundConstraint();
      this.accumulator -= STEP;
      n++;
    }
    if (n === 14) this.accumulator = 0;
    this._updateFades(dt);
    this.syncVisual(dt);
  }

  // Sprite i kadłub statku w świecie, płomienie dysz, render hal (pozy, dachy, lampki).
  syncVisual(dt = 0) {
    const p = this.player;
    const h = this.hullSpec;
    const w = k7HubToWorld(this.frame, p.x, p.z, this._w);
    const heading = k7HeadingToWorld(this.frame, p.angle);
    this.shipWorld.x = w.x;
    this.shipWorld.y = w.y;
    this.shipWorld.heading = heading;
    if (this.active && this.atlas) {
      this.atlas.position.set(w.x, w.y, 0);
      this.atlas.rotation.set(0, 0, heading);
      this.atlas.updateMatrixWorld();
    }
    this.hull.visible = this.active;
    this.hull.position.set(w.x, w.y, 0);
    this.hull.rotation.set(0, 0, heading);
    this.hull.updateMatrixWorld();
    const thrust = p.locked ? 0 : p.thrust;
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const E = h.engines;
    const size = h.h / 806;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const k = Math.max(0, thrust);
      const used = i < E.z.length;
      f.visible = this.active && used && k > 0.015;
      if (!f.visible) continue;
      const sx = (0.3 + k * (0.85 + 0.07 * Math.sin(performance.now() * 0.032 + i))) * size;
      f.scale.set(sx, size, 1);
      const lx = -h.w * E.stern - 195 * sx;
      const ly = E.z[i] * h.h;
      f.position.set(w.x + lx * c - ly * s, w.y + lx * s + ly * c, 1);
      f.rotation.set(0, 0, heading + Math.PI);
      f.material.opacity = Math.min(1, k);
      f.updateMatrixWorld();
    }
    // hale: suwnice (pozy automatu), dach nad statkiem w hali, światła dnia i nocy, lampki stanowisk
    this.ring.k7Halls.forEach((hall, i) => {
      const o = this.registry.halls[i];
      const fr = hall.frame;
      const day = this.daylightAt ? this.daylightAt(fr.origin.x, fr.origin.y) : 1;
      hall.update(dt, { poses: o.poses, roofFade: this.active ? this.hallFades[i].fade : 0, daylight: day });
      hall.setBerthLamps();
    });
    this._cutaways();
  }

  // Kamera gry podąża za statkiem z wyprzedzeniem (K-7 GameplayCamera, bez przechyłu).
  followCamera(gameCam, dt) {
    const p = this.player;
    const inside = this.inside;
    let lx = p.vx * 0.4 * (1 - inside * 0.85);
    let lz = p.vz * 0.4 * (1 - inside * 0.85);
    const len = Math.hypot(lx, lz);
    const cap = Math.min(820, 2600 / Math.max(gameCam.zoom, 0.1) * 0.19);
    if (len > cap) { lx *= cap / len; lz *= cap / len; }
    const w = k7HubToWorld(this.frame, p.x + lx, p.z + lz, this._h);
    const gx = w.x;
    const gy = -w.y;
    if (!this.camInit) {
      this.camTarget.set(gx, gy);
      this.camInit = true;
    } else {
      const k = 1 - Math.exp(-4.2 * dt);
      this.camTarget.x += (gx - this.camTarget.x) * k;
      this.camTarget.y += (gy - this.camTarget.y) * k;
    }
    gameCam.x = this.camTarget.x;
    gameCam.y = this.camTarget.y;
  }

  hud() {
    if (!this.active) return;
    const $ = this.$;
    const p = this.player;
    const d = this.docking;
    const h = this.hullSpec;
    const c = d.state === 'FREE' ? d.candidate() : null;
    const speed = Math.hypot(p.vx, p.vz);
    $('k7-state').textContent = STATES[d.state];
    $('k7-service').textContent = d.detail;
    $('k7-phase').style.width = `${(d.progress * 100).toFixed(1)}%`;
    $('k7-speed').textContent = Math.round(speed);
    $('k7-berth').textContent = d.entry?.label || (c && c.distance < 1800 ? c.entry.label : '--');
    $('k7-fuel').textContent = `${p.fuel.toFixed(0)}%`;
    $('k7-fuel-bar').style.width = `${p.fuel.toFixed(1)}%`;
    $('k7-mode').textContent = p.locked ? 'NAPĘD ZABLOKOWANY' : this.inside > 0.5 ? `MANEWRY PORTOWE · LIMIT ${h.tune.speedIn}` : 'LOT SWOBODNY';
    const near = c ? `wolne ${c.entry.label} · ${(c.distance / 1000).toFixed(1)} km` : 'brak wolnego stanowiska';
    $('k7-gate').textContent = `${h.name} [${h.cls}] · ${near}`;
    let action = '';
    let hint = '';
    if (d.state === 'DOCKED') { action = 'ODDOKUJ (E)'; hint = 'E: odłącz obsługę. Potem S: wycofaj z pola stanowiska.'; }
    else if (d.state === 'FREE') {
      if (c?.ok) { action = `DOKUJ ${c.entry.label} (E)`; hint = 'Pozycja, prędkość i kierunek prawidłowe.'; }
      else if (c && c.distance < 1750) hint = `${c.reason} / ${c.entry.label}`;
      else if (this.inside > 0.65) hint = 'S: wylot tyłem. W: podejście dziobem do stanowiska.';
      else hint = 'Wolne stanowisko w hali K-7 albo w otwartej zatoce: dziobem na pole, wyhamuj, E. V: inny kadłub.';
    } else hint = 'Sekwencja mechaniczna — sterowanie wróci po odsunięciu urządzeń.';
    $('k7-hint').textContent = hint;
    const btn = $('k7-action');
    btn.textContent = action || 'OBSŁUGA';
    btn.disabled = !action;
    btn.style.visibility = action ? 'visible' : 'hidden';
  }

  // Pozycja statku w świecie (do presetów i zrzutów)
  worldToHub(x, y) { return k7WorldToHub(this.frame, x, y, {}); }
}
