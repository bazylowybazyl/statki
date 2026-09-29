// ============================================================
// Atlas 3D w scenie dema: kadłub (atlasHull3D), wieże (weapons3D) w gniazdach edytora,
// celowanie (yaw / pitch z limitami i prędkością obrotu), odrzut luf, wirniki gatlingów,
// wyloty (pozycja + kierunek w świecie), strugi dysz MAIN, światła pozycyjne i reflektory.
// Układ jak Core3D: X ku dziobowi, Z w górę; grupa `root` = poza statku w świecie.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uv, vec3, float, mix, smoothstep, abs, normalView, sin, time, pow, clamp
} from 'three/tsl';
import { buildAtlasHull3D, ATLAS3D_SCALE } from '../../src/3d/ships3d/atlasHull3D.js';
import { buildWeapon3D, WEAPON3D_FAMILY, weapon3DScale } from '../../src/3d/ships3d/weapons3D.js';
import { createShipMaterial, createDeckTexture, createDeckNormalTexture } from '../../src/3d/ships3d/shipMaterials3D.tsl.js';
import { MASTER_WEAPONS } from '../../src/data/weapons.js';
import { MAIN_EXHAUST_PALETTES } from '../../src/data/engineFx.js';

const DEG = Math.PI / 180;

// Domyślny fit gracza jak autoMountDefaults() w index.html (kolejność gniazd edytora).
export function defaultLoadout(mounts) {
  const plan = { main: [['railgun_mk2', 99]], aux: [['ciws_mk1', 6], ['flak_capital', 2]], missile: [['missile_rack', 99]], special_missile: [['supernova_missile', 1]], builtin: [['hexlance_siege', 1]], hangar: [['fighter_squad_multirole', 6]], special: [] };
  return fillLoadout(mounts, plan);
}

/** Fit „pełny”: wszystkie gniazda obsadzone (specjalne i puste aux też). */
export function fullLoadout(mounts) {
  const plan = {
    main: [['railgun_mk2', 99]],
    aux: [['ciws_mk1', 6], ['flak_capital', 2], ['ciws_mk2', 6]],
    missile: [['missile_rack', 99]], special_missile: [['supernova_missile', 1]], builtin: [['hexlance_siege', 1]],
    hangar: [['fighter_squad_multirole', 6]],
    special: [['special_yamato_cannon', 2], ['special_valkyrie_railgun', 2], ['special_goliath_autocannon', 2]]
  };
  return fillLoadout(mounts, plan);
}

function fillLoadout(mounts, plan) {
  const out = {};
  const left = {};
  for (const [type, list] of Object.entries(plan)) left[type] = list.map(([id, n]) => ({ id, n }));
  for (const m of mounts) {
    const q = left[m.type];
    if (!q) continue;
    const slot = q.find((e) => e.n > 0);
    if (!slot) continue;
    slot.n--;
    out[m.id] = slot.id;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wieża (egzemplarz modelu broni w gnieździe)
// ---------------------------------------------------------------------------

export class Turret {
  constructor(mount, weaponId, geo, model, material) {
    this.mount = mount;
    this.weaponId = weaponId;
    this.def = MASTER_WEAPONS[weaponId];
    this.model = model;
    this.scale = weapon3DScale(this.def);
    this.root = new THREE.Object3D();
    this.root.position.set(mount.x, mount.y, mount.z);
    this.root.scale.setScalar(this.scale);
    this.root.name = `wieża ${weaponId} @ ${mount.id}`;
    const mk = (g) => { const m = new THREE.Mesh(g, material); m.castShadow = true; m.receiveShadow = true; return m; };
    this.root.add(mk(geo.ring));
    this.yaw = new THREE.Object3D();
    this.root.add(this.yaw);
    this.yaw.add(mk(geo.housing));
    this.pitch = new THREE.Object3D();
    this.pitch.position.set(model.trunnion[0], 0, model.trunnion[1]);
    this.yaw.add(this.pitch);
    this.barrels = [];
    model.barrels.forEach(([y, z], i) => {
      const b = new THREE.Object3D();
      const shift = model.barrelShift ? model.barrelShift[i] : 0;
      b.position.set(shift, y, z);
      b.userData.x0 = shift;
      b.add(mk(geo.barrel));
      let spin = null;
      if (geo.spin) { spin = new THREE.Object3D(); spin.add(mk(geo.spin)); b.add(spin); }
      this.pitch.add(b);
      this.barrels.push({ obj: b, spin, recoil: 0 });
    });
    // Spoczynek: wyrzutnie z pojemnikami lekko uniesionymi, wieże na wprost dziobu.
    this.yawAngle = 0;
    this.pitchAngle = (model.rest || 0) * DEG;
    this.spinVel = 0;
    this.cool = Math.random() * 0.5;
    this.next = 0;
    this.burstLeft = 0;
    this.yawRate = (weaponId.startsWith('ciws') || this.def?.category === 'ciws' ? 360 : model.launcher ? 90 : this.def?.size === 'Capital' ? 40 : 70) * DEG;
    this.pitchRate = this.yawRate * 0.8;
    this.aimError = Math.PI;
    this._apply();
  }

  _apply() {
    this.yaw.rotation.z = this.yawAngle;
    this.pitch.rotation.y = -this.pitchAngle;
  }

  /** Celowanie w punkt świata (albo null — powrót do spoczynku). */
  aim(target, dt, tmp) {
    let wantYaw = 0;
    let wantPitch = (this.model.rest || 0) * DEG;
    if (target) {
      const p = tmp.copy(target);
      this.root.worldToLocal(p);
      wantYaw = Math.atan2(p.y, p.x);
      const hd = Math.hypot(p.x, p.y) - this.model.trunnion[0];
      const el = Math.atan2(p.z - this.model.trunnion[1], Math.max(1e-3, hd));
      wantPitch = this.model.launcher ? Math.max(el, 25 * DEG) : el;
      wantPitch = Math.min(this.model.pitch[1] * DEG, Math.max(this.model.pitch[0] * DEG, wantPitch));
    }
    let dy = wantYaw - this.yawAngle;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const sy = this.yawRate * dt;
    this.yawAngle += Math.max(-sy, Math.min(sy, dy));
    const dp = wantPitch - this.pitchAngle;
    const sp = this.pitchRate * dt;
    this.pitchAngle += Math.max(-sp, Math.min(sp, dp));
    this.aimError = Math.abs(dy) + Math.abs(dp);
    this._apply();
  }

  update(dt) {
    const back = this.model.recoil;
    for (const b of this.barrels) {
      b.recoil = Math.max(0, b.recoil - dt * back * 5);
      b.obj.position.x = b.obj.userData.x0 - b.recoil;
      if (b.spin) b.spin.rotation.x += this.spinVel * dt;
    }
    this.spinVel = Math.max(0, this.spinVel - dt * 20);
    this.cool = Math.max(0, this.cool - dt);
  }

  /** Strzał (gdy gotowa): odrzut + wirnik, wylot(y) w świecie do cb(pos, dir, turret, i). */
  fire(cb, tmpP, tmpD) {
    if (this.cool > 0) return false;
    const def = this.def || {};
    const cd = Number(def.cooldown) || 1;
    const burst = Number(def.burstCount) || 1;
    this.cool = burst > 1 ? cd / burst : cd;
    this.spinVel = 40;
    const list = this.model.launcher ? [this.barrels[this.next++ % this.barrels.length]] : this.barrels;
    list.forEach((b, i) => {
      b.recoil = this.model.recoil;
      b.obj.updateWorldMatrix(true, false);
      tmpP.set(this.model.muzzleX, 0, 0).applyMatrix4(b.obj.matrixWorld);
      tmpD.setFromMatrixColumn(b.obj.matrixWorld, 0).normalize();
      cb(tmpP, tmpD, this, i);
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Atlas
// ---------------------------------------------------------------------------

export class Atlas3D {
  /**
   * @param {object} o
   * @param {HTMLImageElement} o.image sprite kadłuba (pokład)
   * @param {THREE.Scene} o.scene
   */
  constructor(o) {
    this.root = new THREE.Group();
    this.root.name = 'Atlas 3D';
    o.scene.add(this.root);

    const t0 = performance.now();
    this.hull = buildAtlasHull3D({ bridgeZScale: o.bridgeZScale ?? 2.6 });
    this.hullGeometry = this.hull.builder.toGeometry(THREE, ATLAS3D_SCALE);
    this.buildMs = performance.now() - t0;
    this.deckTex = createDeckTexture(o.image, o.anisotropy ?? 8);
    this.deckNormal = createDeckNormalTexture(o.image);
    this.hullMat = createShipMaterial({ deckMap: this.deckTex, deckNormalMap: this.deckNormal, name: 'Atlas 3D — kadłub' });
    this.hullMesh = new THREE.Mesh(this.hullGeometry, this.hullMat);
    this.hullMesh.castShadow = true;
    this.hullMesh.receiveShadow = true;
    this.hullMesh.name = 'kadłub';
    this.root.add(this.hullMesh);

    this.weaponMat = createShipMaterial({ panelW: 7, panelH: 3.5, name: 'Atlas 3D — broń' });
    this.turretGroup = new THREE.Group();
    this.turretGroup.name = 'wieże';
    this.root.add(this.turretGroup);
    this.turrets = [];
    this.geoCache = new Map();
    this.loadout = {};
    this.turretScale = 1; // mnożnik skali wież (1 = skala gry)
    this.turretsOn = true;

    this._buildPlumes();
    this._buildLights(o.scene);
    // Porównanie z grą: płaski sprite (kwad z alfą) w miejscu kadłuba, na wysokości pokładu.
    const spriteMat = new THREE.MeshStandardNodeMaterial({ map: this.deckTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, metalness: 0.3 });
    spriteMat.normalMap = this.deckNormal;
    this.spriteMesh = new THREE.Mesh(new THREE.PlaneGeometry(3747 * ATLAS3D_SCALE, 1677 * ATLAS3D_SCALE), spriteMat);
    this.spriteMesh.position.z = 23;
    this.spriteMesh.visible = false;
    this.spriteMesh.receiveShadow = true;
    this.spriteMesh.name = 'sprite gry (porównanie)';
    this.root.add(this.spriteMesh);
    this.markers = this._buildMarkers();
    this.markers.visible = false;
    this.root.add(this.markers);

    this.throttle = 0;
    this.time = 0;
    this._p = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  /** Geometrie części rodziny (raz). */
  weaponGeometry(family) {
    if (this.geoCache.has(family)) return this.geoCache.get(family);
    const model = buildWeapon3D(family);
    const g = {
      ring: model.parts.ring.toGeometry(THREE),
      housing: model.parts.housing.toGeometry(THREE),
      barrel: model.parts.barrel.toGeometry(THREE),
      spin: model.parts.spin ? model.parts.spin.toGeometry(THREE) : null
    };
    const entry = { model, geo: g };
    this.geoCache.set(family, entry);
    return entry;
  }

  /** Fit: { idGniazda: idBroni }. Wieże przebudowane (geometrie z cache). */
  setLoadout(map) {
    for (const t of this.turrets) this.turretGroup.remove(t.root);
    this.turrets.length = 0;
    this.loadout = { ...map };
    for (const m of this.hull.mounts) {
      const wid = map[m.id];
      if (!wid) continue;
      const fam = WEAPON3D_FAMILY[wid];
      if (!fam) continue; // hangar, Hexlance (wbudowany w kadłub)
      const { model, geo } = this.weaponGeometry(fam);
      const t = new Turret(m, wid, geo, model, this.weaponMat);
      t.root.scale.setScalar(t.scale * this.turretScale);
      this.turrets.push(t);
      this.turretGroup.add(t.root);
    }
    this.turretGroup.updateMatrixWorld(true);
  }

  /** Porównanie: płaski sprite gry zamiast modelu (strugi i światła zostają). */
  setSpriteMode(on) {
    this.spriteMesh.visible = !!on;
    this.hullMesh.visible = !on;
    this.turretGroup.visible = !on && this.turretsOn;
  }

  setTurretsVisible(on) {
    this.turretsOn = !!on;
    this.turretGroup.visible = this.turretsOn && !this.spriteMesh.visible;
  }

  /** Mnożnik skali wież względem skali gry (podgląd w 3D; wyloty przesuwają się razem z lufami). */
  setTurretScale(k) {
    this.turretScale = k;
    for (const t of this.turrets) t.root.scale.setScalar(t.scale * k);
    this.turretGroup.updateMatrixWorld(true);
  }

  // Strugi MAIN: dwa stożki addytywne na dyszę (rdzeń + otoczka), długość z ciągu.
  _buildPlumes() {
    const pal = MAIN_EXHAUST_PALETTES.find((p) => p.id === 'plazma') || MAIN_EXHAUST_PALETTES[0];
    const ramp = pal.ramp;
    this.uThrust = uniform(0.2);
    const mkMat = (core) => {
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      const c0 = vec3(...ramp[1]); const c1 = vec3(...ramp[2]); const c2 = vec3(...ramp[3]);
      m.colorNode = Fn(() => {
        const v = uv().y; // 1 przy dyszy, 0 na końcu
        const face = abs(normalView.z).toVar();
        const body = pow(face, float(core ? 2.2 : 1.4));
        const along = pow(v, float(core ? 2.4 : 1.3));
        const flick = sin(time.mul(47.0).add(v.mul(9.0))).mul(0.06).add(1.0);
        const col = core ? mix(c1, c2, smoothstep(0.55, 1.0, v)) : mix(c0, c1, v);
        return col.mul(body).mul(along).mul(flick).mul(clamp(this.uThrust, 0.0, 2.0)).mul(core ? 0.32 : 0.12);
      })();
      return m;
    };
    this.plumeMats = [mkMat(false), mkMat(true)];
    // Stożek wzdłuż −X: wierzchołek (v = 1) przy dyszy.
    const cone = (r0, r1) => {
      const g = new THREE.CylinderGeometry(r0, r1, 1, 20, 6, true);
      g.translate(0, -0.5, 0);           // góra (dysza, v = 1) w y = 0, koniec w y = −1
      g.rotateZ(-Math.PI / 2);           // oś −Y → −X (koniec strugi za rufą)
      return g;
    };
    this.plumes = [];
    const outerG = cone(1, 0.25);
    const coreG = cone(0.55, 0.05);
    for (const n of this.hull.nozzles) {
      const g = new THREE.Group();
      g.position.set(n.x, n.y, n.z);
      const outer = new THREE.Mesh(outerG, this.plumeMats[0]);
      const core = new THREE.Mesh(coreG, this.plumeMats[1]);
      outer.renderOrder = 20; core.renderOrder = 21;
      outer.frustumCulled = false; core.frustumCulled = false;
      g.add(outer, core);
      g.userData.r = n.r;
      this.root.add(g);
      this.plumes.push(g);
    }
  }

  // Światła pozycyjne (czerwone, sekwencja „edge”) i reflektory dziobowe: kulki HDR (bloom).
  _buildLights(scene) {
    const list = this.hull.lights;
    const geo = new THREE.SphereGeometry(1, 10, 8);
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = vec3(1);
    this.lightMesh = new THREE.InstancedMesh(geo, mat, list.length);
    this.lightMesh.name = 'światła pozycyjne';
    this.lightMesh.frustumCulled = false;
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    list.forEach((l, i) => {
      const r = l.kind === 'road' ? 2.4 : 2.0;
      m4.makeScale(r, r, r).setPosition(l.x, l.y, l.z);
      this.lightMesh.setMatrixAt(i, m4);
      this.lightMesh.setColorAt(i, c.set(l.color));
    });
    this.lightMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this.lightMesh);
    this.lightList = list;
    // Reflektory: dwa światła stożkowe przed dziobem (zasięg z edytora).
    this.spots = [];
    for (const l of list.filter((q) => q.kind === 'road')) {
      const s = new THREE.SpotLight(0xdfe9ff, 0, (l.range || 800) * 3, (l.coneDeg || 40) * DEG * 0.5, 0.5, 1.0);
      s.position.set(l.x, l.y, l.z);
      s.target.position.set(l.x + 1000, l.y, l.z - 60);
      this.root.add(s, s.target);
      this.spots.push(s);
    }
  }

  // Znaczniki gniazd (kolor typu) — do sprawdzenia rozmieszczenia.
  _buildMarkers() {
    const g = new THREE.Group();
    const colors = { main: 0x55deff, special: 0xff4fd8, aux: 0x6dffc0, missile: 0xffbb77, special_missile: 0xff7cf2, builtin: 0xd0eaff, hangar: 0xffe08a };
    const geo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
    geo.rotateX(Math.PI / 2);
    for (const m of this.hull.mounts) {
      const mat = new THREE.MeshBasicNodeMaterial({ color: colors[m.type] || 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      const r = Math.max(6, m.radius || 8);
      mesh.scale.set(r, r, 40);
      mesh.position.set(m.x, m.y, m.z + 20);
      g.add(mesh);
    }
    return g;
  }

  /** Czas klatki: odrzut, wirniki, strugi, sekwencja świateł. */
  update(dt, o = {}) {
    this.time += dt;
    for (const t of this.turrets) t.update(dt);
    // Struga: długość i jasność z ciągu (0..1, dopalacz do 1,6).
    const thr = Math.max(0.12, this.throttle);
    this.uThrust.value = thr;
    for (const p of this.plumes) {
      const r = p.userData.r;
      const len = r * (2.2 + 9 * thr);
      p.scale.set(len, r * (0.9 + 0.25 * thr), r * (0.9 + 0.25 * thr));
      p.visible = o.plumes !== false;
    }
    this.hullMat.userData.uniforms.engine.value = 0.6 + thr * 0.9;
    // Światła: fala wzdłuż burt (grupa „edge”), reflektory stale.
    const c = new THREE.Color();
    const on = o.lights !== false;
    this.lightList.forEach((l, i) => {
      let k = 0;
      if (on) {
        if (l.kind === 'road') k = 2.2;
        else {
          const ph = ((l.x / 1800) * 1.4 + this.time * 0.9) % 1;
          k = ph < 0 ? 0 : 0.25 + 7 * Math.exp(-((((ph < 0.5 ? ph : 1 - ph) * 9)) ** 2));
        }
      }
      this.lightMesh.setColorAt(i, c.set(l.color).multiplyScalar(k * (l.power || 1)));
    });
    this.lightMesh.instanceColor.needsUpdate = true;
    for (const s of this.spots) s.intensity = on && o.spots !== false ? 1600 : 0;
  }

  /** Celowanie grup: targets = { main, special, aux, missile } → Vector3 | null. */
  aim(targets, dt) {
    for (const t of this.turrets) {
      const g = t.mount.type === 'special_missile' ? 'missile' : t.mount.type;
      t.aim(targets[g] || null, dt, this._t);
    }
  }

  /** Strzał grupy; cb(pos, dir, turret, i) dla każdego wylotu. Zwraca liczbę salw. */
  fire(group, cb, maxAimError = 0.2) {
    let n = 0;
    for (const t of this.turrets) {
      const g = t.mount.type === 'special_missile' ? 'missile' : t.mount.type;
      if (g !== group) continue;
      if (t.aimError > maxAimError && !t.model.launcher) continue;
      if (t.fire(cb, this._p, this._d)) n++;
    }
    return n;
  }

  /** Wylot Hexlance'a w świecie (działo osiowe wbudowane w kadłub). */
  hexlanceMuzzle(out) {
    const h = this.hull.hexlanceMuzzle;
    return out.set(h.x, h.y, h.z).applyMatrix4(this.root.matrixWorld);
  }

  stats() {
    const pos = this.hullGeometry.attributes.position.count;
    const tri = this.hullGeometry.index.count / 3;
    let wt = 0;
    for (const t of this.turrets) t.root.traverse((o) => { if (o.isMesh) wt += o.geometry.index.count / 3; });
    return { hullVerts: pos, hullTris: tri, turrets: this.turrets.length, turretTris: wt, buildMs: Math.round(this.buildMs) };
  }
}
