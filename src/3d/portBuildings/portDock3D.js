// Render budowli doku portu bez ringu (E14: krzyż, okrąg, koło z wlotem) — ta sama podstawa co budowle portowe Z7
// i baza piratów (PortBuilding3D: korzeń z ramką układu w macierzy, zestawy BG / FG, grafy TSL raz na tryb światła,
// lekkie materiały na wspólnych węzłach). Bez własnego renderera: gospodarz (src/3d/portDocks3D.js) dodaje `root`
// do Core3D.scene i ustawia warstwy (BG 1 pod statkami, FG 2 nad nimi — jak hale K-7).
//
// Ramka: `portModuleFrame(x, −y, −kąt)` — oś z budowli = oś +u doku w scenie (y sceny = −y gry, kąty z minusem),
// wyznacznik +1 (pułapka 37: ten sam pipeline co szablon w rozgrzewce). Duży offset świata tylko w `root.matrix`.
// Obraca się tylko piasta koła (grupa `rig.hubGroup` — obraz; kolizje stoją): obrót wokół osi pionowej przez środek.
import * as THREE from 'three';
import { PortBuilding3D } from './portBuildings3D.js';
import { resolvePortBuildingStyle } from './portBuildingStyle.js';
import { portHubMatrixElements, portModuleFrame } from './portModuleTraffic.js';
import { buildPortDockScene } from './portDockScene.js';

/** Obrót piasty koła [rad/s] — pełny obrót w ~4 min (obrzeże piasty ~90 j./s). */
export const PORT_DOCK_HUB_SPIN = (Math.PI * 2) / 240;

const _tick = { daylight: 0.3, lampPower: 1.1 };
const _yAxis = new THREE.Vector3(0, 1, 0);

export class PortDock3D extends PortBuilding3D {
  /**
   * @param {object} o  { geometry (buildPortDockGeometry), style ('earth' | 'mars' | 'jupiter' | 'pirate' albo styl),
   *                      x, y, angle (środek i kąt osi +u w grze), name }
   */
  constructor(o = {}) {
    const style = o.style && o.style.palette ? o.style : resolvePortBuildingStyle(o.style || 'earth');
    const geometry = o.geometry;
    super({
      layout: geometry,
      scene: buildPortDockScene(geometry, style),
      style,
      frame: portModuleFrame(0, 0, 0),
      name: o.name || `Dok ${geometry.kind}`,
      // zestaw BG w passie gry (warstwa 0, po planetach — jak statki): ośrodek pasa jak kadłuby (Ceres, Westa)
      volume: true
    });
    this.geometry = geometry;
    this.rig = this.scene.rig;
    this.hubAngle = 0;
    this.placeX = NaN;
    this.placeY = NaN;
    this.placeAngle = NaN;
    if (Number.isFinite(o.x)) this.place(o.x, o.y, o.angle);
    this.update(0);
  }

  /** Ramka w świecie gry (środek x, y i kąt osi +u). Zmienia macierz tylko przy innej pozie (budowle stoją). */
  place(x, y, angle) {
    if (x === this.placeX && y === this.placeY && angle === this.placeAngle) return;
    this.placeX = x;
    this.placeY = y;
    this.placeAngle = angle;
    this.frame = portModuleFrame(x, -y, -angle);
    this.root.matrix.fromArray(portHubMatrixElements(this.frame));
    this.root.matrixWorldNeedsUpdate = true;
  }

  /** Klatka: zegar efektów (światła biegnące, koguty), obrót piasty koła. */
  update(dt) {
    const step = Math.max(0, Number(dt) || 0);
    this.tick(step, _tick);
    const G = this.uniforms.uGroup.value;
    G[0].identity();
    const hub = this.rig.hubGroup;
    if (hub > 0) {
      this.hubAngle = (this.hubAngle + step * PORT_DOCK_HUB_SPIN) % (Math.PI * 2);
      G[hub].makeRotationAxis(_yAxis, this.hubAngle);
    }
  }
}
