// Tryb „Lot K-7” dema ringu: rozgrywka doku gameplayowego z dema ECUMENE
// (orbital_ring_gameplay_hub_v3.html) na nowym ringu. Atlas lata w płaszczyźnie
// gry (z = 0), kamera gry podąża za nim, E = dokuj / oddokuj, W/S ciąg,
// A/D obrót, Spacja hamulec, Shift dopalacz (poza halą).
//
// Model lotu i automat dokowania: haloPortK7Layout.js (czysta logika z K-7).
// Render hali: ring.k7 (haloPortK7.js). Tu tylko klej: stały krok 120 Hz,
// wejście, kamera, HUD, sprite i kadłub Atlasa, płomienie dysz.
//
// Hala jest wpięta w podłogę habitatu na środku wstęgi (płaszczyzna gry
// przecina ring przez środek): podłoga i kadłub poza halą to przeszkoda —
// przez ring prowadzą tylko 4 tranzyty (tunele w płycie, jak w K-7 z ECUMENE;
// klawisz T = skok przed najbliższy). Górna ściana ringu nad wąwozem habitatu
// dostaje wycięcia nad graczem (ring.setCutaway) — jak dach hali K-7.
import * as THREE from 'three';
import {
  K7_ATLAS,
  K7_ATLAS_COLLISION,
  K7Docking,
  K7FlightModel,
  K7RoofFade,
  buildK7Collision,
  k7HeadingToWorld,
  k7HeightToZ,
  k7HubToWorld,
  k7WorldToHub
} from '../src/3d/haloRing/haloPortK7Layout.js';
import { HALO_PORT, HALO_TRANSIT, haloPortSites, haloTransitAngles } from '../src/3d/haloRing/haloRingConfig.js';

const STEP = 1 / 120;
const STATES = { DOCKED: 'ZADOKOWANY', DOCKING: 'DOKOWANIE', UNDOCKING: 'ODDOKOWANIE', FREE: 'LOT RĘCZNY' };

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

// Kadłub Atlasa do kamery kinowej: wytłoczona obwiednia (ciemna burta pod
// sprite'em) — w kamerze gry widać ją tylko jako lekką grubość przy brzegach.
function atlasHull(layerBg) {
  const shape = new THREE.Shape();
  K7_ATLAS_COLLISION.forEach(([u, v], i) => {
    const x = u * K7_ATLAS.w;
    const y = v * K7_ATLAS.h;
    if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
  });
  const depth = -k7HeightToZ(48);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth - 1);
  const m = new THREE.MeshBasicMaterial({ color: 0x0b1116 });
  const mesh = new THREE.Mesh(g, m);
  mesh.layers.set(layerBg);
  mesh.frustumCulled = false;
  return mesh;
}

export class K7FlightDemo {
  constructor({ ring, scene, atlas, layers, $ }) {
    this.ring = ring;
    this.$ = $;
    this.atlas = atlas;
    this.layout = ring.k7Layout;
    this.frame = ring.k7.frame;
    this.transitAngles = haloTransitAngles();
    this.collision = buildK7Collision(this.layout);
    this._addDockWalls();
    this._addTransitWalls();
    this.player = new K7FlightModel(this.collision, this.layout.spawnPoint);
    this.docking = new K7Docking(this.layout, this.player);
    const fp = this.layout.footprint.map(([x, z]) => ({ x, z }));
    this.roof = new K7RoofFade(fp);
    this.player.onNotice = (t) => this.notice(t);
    this.docking.onNotice = (t) => this.notice(t);
    this.accumulator = 0;
    this.active = false;
    this.keys = null;
    this.camTarget = new THREE.Vector2();
    this.camInit = false;
    this._w = {};
    this._h = {};
    // kadłub pod sprite'em + płomienie dysz (świat ortho jak statki gry)
    this.hull = atlasHull(layers.bg);
    scene.add(this.hull);
    const tex = flameTexture();
    this.flames = [-53, 0, 53].map((z) => {
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0x9fe6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(390, 64), mat);
      mesh.layers.set(layers.world);
      mesh.frustumCulled = false;
      mesh.userData.offset = z;
      scene.add(mesh);
      return mesh;
    });
    this.roof.update(this.player.polygon(), 0, true);
    // płyta podłogi z kadłubem poza halą i tranzytami: środek statku poza
    // pasem [kadłub − pół statku, podłoga + pół statku]
    this.floorLimit = this.frame.floorR + K7_ATLAS.w * 0.5 + 60;
    this.backLimit = this.ring.layout.radii.back - K7_ATLAS.w * 0.5 - 60;
    this.hallHalf = this.layout.halfWidth + 600;
    this.syncVisual();
    this._bindHud();
  }

  // Ściany boczne i kołnierze zatok doków transportowych (obok K-7) jako
  // przeszkody lotu — prostokąty obrócone o różnicę kątów doku i huba.
  _addDockWalls() {
    const L = this.ring.layout;
    const f = this.frame;
    const P = HALO_PORT;
    const rF = f.floorR;
    const D = L.wallHeight + P.reach;
    const tmp = {};
    for (const site of haloPortSites(L.radii.floorMid)) {
      if (site.kind !== 'dock') continue;
      const c = Math.cos(site.theta);
      const s = Math.sin(site.theta);
      const toHub = (xd, yd) => k7WorldToHub(f, rF * c - xd * s + yd * c, rF * s + xd * c + yd * s, tmp);
      const ang = Math.atan2(-s * f.rx + c * f.ry, -s * f.tx + c * f.ty);
      for (const sd of [-1, 1]) {
        const tag = `DOK ${site.index + 1} ${sd < 0 ? 'W' : 'E'}`;
        let h = toHub(sd * (P.dockLength - P.sideWall) * 0.5, D * 0.5);
        this.collision.addBox(tag, h.x, h.z, P.sideWall, D, ang, -80, 460);
        h = toHub(sd * (P.dockLength + P.collar) * 0.5, P.collarDepth * 0.5 - 30);
        this.collision.addBox(tag + ' / KOŁNIERZ', h.x, h.z, P.collar, P.collarDepth + 60, ang, -80, 460);
      }
    }
  }

  // Tunele tranzytów: ściany i słupy portali (obu wylotów) jako przeszkody.
  _addTransitWalls() {
    const f = this.frame;
    const T = HALO_TRANSIT;
    const rF = f.floorR;
    const slab = rF - this.ring.layout.radii.back;
    const tmp = {};
    this.transitAngles.forEach((theta, i) => {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const toHub = (xd, yd) => k7WorldToHub(f, (rF + yd) * c - xd * s, (rF + yd) * s + xd * c, tmp);
      const ang = Math.atan2(-s * f.rx + c * f.ry, -s * f.tx + c * f.ty);
      const id = 'T-' + String(i + 1).padStart(2, '0');
      for (const sd of [-1, 1]) {
        let h = toHub(sd * (T.halfWidth + T.wall * 0.5), (30 - slab - 40) * 0.5);
        this.collision.addBox(id + ' ŚCIANA', h.x, h.z, T.wall, slab + 70, ang, -80, 460);
        for (const [y0, y1] of [[-60, 150], [-slab - 150, -slab + 60]]) {
          h = toHub(sd * (T.halfWidth + T.wall + T.frame * 0.5), (y0 + y1) * 0.5);
          this.collision.addBox(id + ' PORTAL', h.x, h.z, T.frame, y1 - y0, ang, -80, 460);
        }
      }
    });
  }

  // Środek statku w korytarzu tranzytu (płyta przecięta tunelem)?
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
    const r = f.floorR + 1500;
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

  // Płyta podłogi z kadłubem — dopychanie promieniowe na bliższą stronę, bez odbicia.
  _floorConstraint() {
    const p = this.player;
    if (Math.abs(p.x) < this.hallHalf && p.z > 0) return;
    const w = k7HubToWorld(this.frame, p.x, p.z, this._w);
    const r = Math.hypot(w.x, w.y);
    if (r >= this.floorLimit || r <= this.backLimit) return;
    if (this._inTransit(w.x, w.y)) return;
    const target = r - this.backLimit < this.floorLimit - r ? this.backLimit : this.floorLimit;
    const ux = w.x / r;
    const uy = w.y / r;
    const f = this.frame;
    const k = target / r;
    const hub = k7WorldToHub(f, w.x * k, w.y * k, this._h);
    p.x = hub.x;
    p.z = hub.z;
    // prędkość w głąb płyty (składowa promieniowa w układzie huba) zerowana
    const rx = ux * f.tx + uy * f.ty;
    const rz = ux * f.rx + uy * f.ry;
    const vr = p.vx * rx + p.vz * rz;
    const into = target > r ? vr < 0 : vr > 0;
    if (into) { p.vx -= vr * rx; p.vz -= vr * rz; }
  }

  // Wycięcia górnej ściany ringu (kamera gry): nad halą, gdy dach hali znika
  // (gracz w środku), i koło nad statkiem, gdy leci pod górną ścianą.
  _cutaways() {
    const ring = this.ring;
    if (!ring.setCutaway) return;
    if (!this.active) { ring.setCutaway(0, null); ring.setCutaway(1, null); return; }
    const f = this.frame;
    const l = this.layout;
    const z0 = f.floorZ - 100;
    const z1 = f.rimZ + 800;
    const c = k7HubToWorld(f, 0, (z0 + z1) * 0.5, this._h);
    ring.setCutaway(0, { x: c.x, y: c.y, angle: Math.atan2(f.ty, f.tx), a: l.halfWidth + 600, b: (z1 - z0) * 0.5, strength: this.roof.fade });
    const s = this.shipWorld;
    const r = Math.hypot(s.x, s.y);
    const rim = ring.layout.radii.rim;
    const back = ring.layout.radii.back;
    // pod górną ścianą: wąwóz habitatu, tunel tranzytu i pas tuż za kadłubem
    const under = Math.min(1, Math.max(0, (rim + 1300 - r) / 700)) * Math.min(1, Math.max(0, (r - (back - 1500)) / 700));
    ring.setCutaway(1, { x: s.x, y: s.y, a: 1350, b: 1350, strength: under });
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

  // stan startowy do zrzutów: 'docked' | 'free' (na pasie przed C-01)
  reset(mode = 'docked') {
    const l = this.layout;
    for (const b of l.berths) {
      if (b.size === 'CAPITAL') { b.occupied = b.id === 'C-01' ? 'player' : null; b.reserved = b.id === 'C-01' ? 'player' : null; }
    }
    for (const lane of l.lanes) lane.reserved = lane.berthId === 'C-01' ? 'player' : null;
    this.player = new K7FlightModel(this.collision, l.spawnPoint);
    this.player.onNotice = (t) => this.notice(t);
    this.docking = new K7Docking(l, this.player);
    this.docking.onNotice = (t) => this.notice(t);
    if (mode === 'free') {
      this.docking.update(0);
      this.docking.state = 'FREE';
      this.docking.berth = null;
      for (const pose of this.docking.poses.values()) Object.assign(pose, { bridge: 0, trolley: 0, lower: 0, clamp: 0, extension: 0, lock: 0, flow: 0, vent: 0 });
      l.berths[0].occupied = null;
      l.berths[0].reserved = null;
      l.lanes[0].reserved = null;
      this.player.locked = false;
      // przed bramą główną G-01, dziobem do hali, na pasie C-01
      this.player.x = l.berths[0].x;
      this.player.z = l.frontZ + l.apronDepth - 150;
      this.player.angle = -Math.PI / 2;
    }
    this.roof.update(this.player.polygon(), 0, true);
    this.camInit = false;
  }

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
      p.step(STEP, this.roof.fade);
      this._floorConstraint();
      this.accumulator -= STEP;
      n++;
    }
    if (n === 14) this.accumulator = 0;
    this.roof.update(p.polygon(), dt);
    this.syncVisual();
  }

  // Sprite i kadłub Atlasa w świecie, płomienie dysz, render hali.
  syncVisual() {
    const p = this.player;
    const w = k7HubToWorld(this.frame, p.x, p.z, this._w);
    const heading = k7HeadingToWorld(this.frame, p.angle);
    this.shipWorld = { x: w.x, y: w.y, heading };
    if (this.active) {
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
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const k = Math.max(0, thrust);
      f.visible = this.active && k > 0.015;
      const sx = 0.3 + k * (0.85 + 0.07 * Math.sin(performance.now() * 0.032 + i));
      f.scale.set(sx, 1, 1);
      const lx = -K7_ATLAS.w * 0.463 - 195 * sx;
      const ly = f.userData.offset;
      f.position.set(w.x + lx * c - ly * s, w.y + lx * s + ly * c, 1);
      f.rotation.set(0, 0, heading + Math.PI);
      f.material.opacity = Math.min(1, k);
      f.updateMatrixWorld();
    }
    const k7 = this.ring.k7;
    if (k7) {
      k7.update(0, { poses: this.docking.poses, roofFade: this.active ? this.roof.fade : 0, daylight: this.daylight ?? 1 });
      k7.setBerthLamps(this.layout);
    }
    this._cutaways();
  }

  // Kamera gry podąża za statkiem z wyprzedzeniem (K-7 GameplayCamera, bez przechyłu).
  followCamera(gameCam, dt) {
    const p = this.player;
    const inside = this.roof.fade;
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
    const c = d.state === 'FREE' ? d.candidate() : null;
    const speed = Math.hypot(p.vx, p.vz);
    $('k7-state').textContent = STATES[d.state];
    $('k7-service').textContent = d.detail;
    $('k7-phase').style.width = `${(d.progress * 100).toFixed(1)}%`;
    $('k7-speed').textContent = Math.round(speed);
    $('k7-berth').textContent = d.berth?.id || (c && c.distance < 1800 ? c.berth.id : '--');
    $('k7-fuel').textContent = `${p.fuel.toFixed(0)}%`;
    $('k7-fuel-bar').style.width = `${p.fuel.toFixed(1)}%`;
    $('k7-mode').textContent = p.locked ? 'NAPĘD ZABLOKOWANY' : this.roof.fade > 0.5 ? 'MANEWRY PORTOWE · LIMIT 210' : 'LOT SWOBODNY';
    const l = this.layout;
    const gateDist = Math.hypot(p.x, p.z - l.frontZ);
    $('k7-gate').textContent = `brama G-01: ${(gateDist / 1000).toFixed(1)} km`;
    let action = '';
    let hint = '';
    if (d.state === 'DOCKED') { action = 'ODDOKUJ (E)'; hint = 'E: odłącz obsługę. Potem S: wycofaj po swoim pasie.'; }
    else if (d.state === 'FREE') {
      if (c?.ok) { action = `DOKUJ ${c.berth.id} (E)`; hint = 'Pozycja, prędkość i kierunek prawidłowe.'; }
      else if (this.roof.fade > 0.65) hint = c && c.distance < 1750 ? `${c.reason} / ${c.berth.id}` : 'S: wylot tyłem. W: podejście dziobem do stanowiska.';
      else hint = 'Powrót: główna brama K-7. Na stanowisku wyhamuj i naciśnij E.';
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
