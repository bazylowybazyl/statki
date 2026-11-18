// HUTA — formowanie, etap „Złożenie”: OBRAZ OTOCZENIA — jedna siatka stała (`buildFormingStatic`), jeden materiał
// (`createOutsideMaterial`), wspólne uniformy wytopu (słońce, kamera, paleta metalu, żar gardzieli, generator 0 g) +
// własne (zawór wylewki, żar wylewki i rury, dok żużla, zacisk pola) + blok świateł linii (zgaszony do etapu „Pasmo”). 1 rysunek.
import { Budowniczy, meshFromBuilder } from '../wytop/wyposazenie.js';
import { DOK_ZUZLA } from './geometria.js';
import { buildFormingStatic } from './otoczenie.js';
import { createOutsideMaterial, createOutsideUniforms } from './otoczenieTSL.js';
import { createLineLightUniforms } from './swiatloLinii.js';

export class ZlozenieObraz {
  /**
   * @param {object} o
   * @param {import('three').Group} o.root   grupa w układzie komory (ta sama co komora wytopu)
   * @param {object} o.U                      uniformy wytopu (`WytopObraz.U`)
   */
  constructor({ root, U }) {
    this.U = U;
    this.OU = createOutsideUniforms();
    this.LU = createLineLightUniforms();
    // (etap „Walcowanie”: klatki, napęd, pętlowniki, noże, brama — ok. 45 tys. wierzchołków więcej)
    const B = new Budowniczy(300000);
    buildFormingStatic(B);
    if (B.over) throw new Error(`formowanie: za mała pojemność siatki otoczenia (brakuje ${B.over} wierzchołków)`);
    this.verts = B.n;
    this.material = createOutsideMaterial(U, this.OU, this.LU);
    this.mesh = meshFromBuilder(B, this.material, 'Formowanie_otoczenie');
    this.mesh.geometry.boundingSphere.radius = 4000;
    root.add(this.mesh);
    this.meshes = [this.mesh];
  }

  setLayers(layer) { for (const m of this.meshes) m.layers.set(layer); }

  warmupMeshes() { return this.meshes.slice(); }

  /**
   * Pole linii: siła 20 kanałów emiterów (`POLE_KANAL` + pętlowniki walcowni, Float32Array / tablica), dosunięcie paneli C1 (0…1),
   * zacisk pola: położenie (x [j.]), siła, brzuch z metalem przed zaciskiem (0…1) — bramki świecą przy zacisku.
   */
  field(strengths, chill, pinX = 0, pinF = 0, hold = 0) {
    const a = this.OU.pole.array;
    // (kanały 16–19: walcownia — pętlowniki polowe; 20–31: ciepło paneli chłodnic (runda 7); tablica krótsza → zera)
    for (let k = 0; k < a.length; k++) a[k].set(strengths[k * 4] || 0, strengths[k * 4 + 1] || 0, strengths[k * 4 + 2] || 0, strengths[k * 4 + 3] || 0);
    this.OU.line.value.x = chill;
    this.OU.line.value.y = pinX;
    this.OU.line.value.z = pinF;
    this.OU.line.value.w = hold;
  }

  /**
   * Stan klatki: kąt klap zaworu wylewki [rad], dok żużla (wypełnienie 0…1, świeżość 0…1), żar strugi w wylewce i metalu
   * w rurze spustowej (0…1).
   */
  frame(valveAngle, dockFill, dockHeat, spoutHeat = 0, pipeHeat = 0) {
    this.OU.valve.value.x = valveAngle;
    this.OU.valve.value.y = spoutHeat;
    this.OU.valve.value.z = pipeHeat;
    this.OU.dock.value.x = Math.max(0, Math.min(1, dockFill)) * (DOK_ZUZLA.h - 16);
    this.OU.dock.value.y = dockHeat;
  }
}
