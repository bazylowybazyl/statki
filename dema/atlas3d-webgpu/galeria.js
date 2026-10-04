// ============================================================
// Galeria broni 3D: po jednym modelu z każdej rodziny (weapons3D) na postumencie, w siatce.
// Rozmiar: DOPASOWANY (każda broń ~80 j. długości — detale widać także u CIWS-a) albo SKALA
// GRY (weapon3DScale — wieże jak na kadłubie; CIWS to wtedy kilka jednostek). Wieże śledzą
// krążący punkt i strzelają co chwilę — widać obrót, podniesienie, odrzut, wirniki i wyloty.
// Etykiety HTML nad postumentami.
// ============================================================
import * as THREE from 'three/webgpu';
import { WEAPON3D_FAMILY_LABEL, weapon3DScale } from '../../src/3d/ships3d/weapons/weapons3D.js';
import { MeshBuilder3D, SHIP3D_MAT as M, ngonPoly } from '../../src/3d/ships3d/meshBuilder3D.js';
import { MASTER_WEAPONS } from '../../src/data/weapons.js';
import { Turret } from './statek.js';

// Przedstawiciel rodziny (skala gry = ta broń).
const PICK = {
  tempest1: 'railgun_mk1', tempest2: 'railgun_mk2', vulcan: 'vulcan_minigun', helios: 'helios_laser', heavy: 'heavy_autocannon',
  armata: 'armata_mk1', beamC: 'beam_continuous', beamP: 'beam_pulse', ciws1: 'ciws_mk1', ciws2: 'ciws_mk2', heliosPd: 'laser_pd_mk1',
  flakL: 'flak_m', flakH: 'flak_capital', cruise: 'missile_rack', fast: 'fast_missile_rack', osa: 'osa_micro_missile',
  supernova: 'supernova_missile', torpedo: 'siege_torpedo_mk2', goliath: 'special_goliath_autocannon',
  plasmaGatling: 'special_plasma_gatling', valkyrie: 'special_valkyrie_railgun', mjolnir: 'siege_railgun', yamato: 'special_yamato_cannon'
};

const FIT_LENGTH = 80;

// Długość modelu w jednostkach lokalnych (tył obudowy → wylot).
function localLength(model, geo) {
  geo.housing.computeBoundingBox();
  const rear = geo.housing.boundingBox.min.x;
  const front = model.trunnion[0] + model.muzzleX;
  return Math.max(10, front - rear);
}

export class WeaponGallery {
  constructor(scene, ship, material, o = {}) {
    this.group = new THREE.Group();
    this.group.name = 'galeria broni';
    this.group.position.set(o.x ?? 0, o.y ?? -9000, 0);
    this.group.visible = false;
    scene.add(this.group);
    this.items = [];
    this.gameScale = false;
    const fams = Object.keys(PICK);
    const cols = 5;
    const step = 230;
    const rows = Math.ceil(fams.length / cols);
    // Postument: ośmiokątny cokół, pierścień obrotnicy, akcent (malowany cyjan, bez emisji) i mała lampka.
    const B = new MeshBuilder3D();
    B.prism(ngonPoly(0, 0, 58, 8, Math.PI / 8), -24, 0, { bevel: [3, 3], bottom: true, mat: M.PANEL, capMat: M.DARK });
    B.lathe([[44, 0], [44, 1.6], [41, 3], [0, 3]], { seg: 32, mats: [M.PANEL, M.BRIGHT, M.PANEL] });
    B.lathe([[52, -0.2], [52, 0.4], [49, 0.4]], { seg: 32, mats: [M.TRIM, M.TRIM] });
    B.box(0, -56.2, -12, 6, 1, 3, { mat: M.E_CYAN, bottom: false });
    const plinthGeo = B.toGeometry(THREE);
    fams.forEach((fam, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - (cols - 1) / 2) * step;
      const y = ((rows - 1) / 2 - row) * step;
      const plinth = new THREE.Mesh(plinthGeo, material);
      plinth.position.set(x, y, 0);
      plinth.receiveShadow = true;
      plinth.castShadow = true;
      this.group.add(plinth);
      const wid = PICK[fam];
      const { model, geo } = ship.weaponGeometry(fam);
      const mount = { id: `galeria_${fam}`, type: 'gallery', x, y, z: 3, radius: 0 };
      const t = new Turret(mount, wid, geo, model, material);
      const def = MASTER_WEAPONS[wid];
      const sGame = weapon3DScale(def);
      const sFit = FIT_LENGTH / localLength(model, geo);
      t.root.scale.setScalar(sFit);
      this.group.add(t.root);
      this.items.push({
        fam, wid, turret: t, sGame, sFit, pos: new THREE.Vector3(x, y, 0),
        label: `${WEAPON3D_FAMILY_LABEL[fam]} · ${def?.size || '?'} ×${sGame.toFixed(2)}`
      });
    });
    this.time = 0;
    this._w = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }

  /** Rozmiar: skala gry (true) albo dopasowany (false). */
  setGameScale(on) {
    this.gameScale = !!on;
    for (const it of this.items) it.turret.root.scale.setScalar(on ? it.sGame : it.sFit);
    this.group.updateMatrixWorld(true);
  }

  /** Punkt śledzony przez wieże (świat). */
  aimPoint(out) {
    const a = this.time * 0.35;
    return out.set(Math.cos(a) * 1100, Math.sin(a) * 900, 320 + Math.sin(this.time * 0.9) * 220).add(this.group.position);
  }

  update(dt, fx, fire = true) {
    this.time += dt;
    this.group.updateMatrixWorld(true);
    const p = this.aimPoint(this._w);
    for (const it of this.items) {
      it.turret.aim(p, dt, this._t);
      it.turret.update(dt);
      if (fire && fx && it.turret.aimError < 0.25 && Math.random() < dt * 0.9) {
        const k = it.turret.root.scale.x;
        it.turret.fire((pos, dir) => {
          const def = it.turret.def || {};
          const launcher = it.turret.model.launcher;
          fx.flash(pos, def.vfxColor || '#9fe8ff', (launcher ? 3.5 : 4) * k, 0.1, 4);
          fx.shoot({ pos, dir, speed: launcher ? 700 : Math.min(3000, def.baseSpeed || 2500), color: def.vfxColor || '#9fe8ff', len: (launcher ? 16 : 30) * k, width: (launcher ? 4 : 2.2) * k, life: launcher ? 1.4 : 0.45, damage: 0, kind: launcher ? 'missile' : 'bolt', glow: 5 });
        }, new THREE.Vector3(), new THREE.Vector3());
      }
    }
  }

  /** Środek i promień kadru (cała galeria albo pozycja i). */
  frame(i = -1) {
    if (i >= 0 && this.items[i]) return { center: this.items[i].pos.clone().add(this.group.position).add(new THREE.Vector3(0, 0, 30)), radius: 120 };
    return { center: this.group.position.clone().add(new THREE.Vector3(0, 0, 30)), radius: 620 };
  }
}
