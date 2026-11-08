// ============================================================
// Mapa gwiezdna — FLOTY NA MAPIE (obraz, dema/mapa-gwiezdna.html): jak w Starsectorze flota to kilka małych
// statków w szyku z ogonami silników w barwie frakcji.
//
//   • SYLWETKI — sprite'y kadłubów gry (te same pliki co w grze, nos w +x) w jednym atlasie 2048 × 768
//     (komórki 512 × 256, kadr przycięty do alfy, mipmapy). Skład floty z danych (`fleetComposition`,
//     src/game/sector/sectorFleets.js), szyk i rozmiary ikon — tu (px CSS przy skali 1; skala rośnie z
//     przybliżeniem: `shipScale`). Gracz: Atlas; eskorta (klawisz F w demie) — wiersz kopiujący gracza.
//   • OGONY — wstęgi za każdym statkiem z HISTORII położeń floty: bufor storage `wiersze × (TRAIL.samples
//     + 2)` vec4 — kolumna 0: (widoczność, ciąg 0..1, nurt, —), 1: teraz (x, y, kurs, t), 2…: próbki co
//     `TRAIL.every` s (przesuwane co próbkę na CPU — bez pierścienia w shaderze). Shader składa punkt wstęgi
//     = położenie floty w chwili próbki + przesunięcie statku w szyku obrócone kursem z tej chwili (px → ly
//     dzielone przez bieżący zoom), więc ogony zgadzają się przy każdym przybliżeniu, a szyk w zakręcie
//     zostawia łuki. Kołysanie w szyku (sin z czasu próbki) daje lekko falujące ogony. Jasność: wiek
//     próbki × prędkość odcinka (flota w porcie / w zasadzce nie ciągnie ogona) × widoczność wiersza.
//   • POŚWIATA DYSZ — kwad addytywny za rufą, siła z ciągu (HDR → bloom).
// Mieszanie: ogony i dysze addytywne (alfa 1 — pułapka 43), sylwetki zwykłe; barwa sylwetki przez
// `acesGryInv` (po ACES + sRGB wychodzi jak w pliku). Losowość obrazu — brak (fazy z indeksów).
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, clamp, cos, exp, float, int, max, min, mix, positionGeometry, sin, smoothstep, storage, texture,
  uniform, varyingProperty, vec2, vec3, vec4, length, abs
} from 'three/tsl';
import { acesGryInv } from '../src/3d/skybake/skyGameColor.js';
import { fleetComposition, fleetVisibleToPlayer, FLEET_KINDS, FLEET_MODE, SECTOR_FLIGHT } from '../src/game/sector/index.js';
import { FACTIONS } from '../src/data/factions.js';

const url = (p) => new URL(p, import.meta.url).href;

/** Sylwetki: klucz → plik sprite'a gry i długość ikony [px CSS przy skali 1]. */
export const MAP_HULLS = Object.freeze({
  atlas: { src: url('../assets/capital_ship_rect_v1.png'), len: 46 },
  'terra:fregata': { src: url('../src/assets/ships/terranfrigate.png'), len: 16 },
  'terra:niszczyciel': { src: url('../src/assets/ships/terrandestroyer.png'), len: 21 },
  'terra:pancernik': { src: url('../src/assets/ships/terranbattleship.png'), len: 28 },
  'piraci:fregata': { src: url('../src/assets/ships/piratefrigate.png'), len: 16 },
  'piraci:niszczyciel': { src: url('../src/assets/ships/piratedestroyer.png'), len: 21 },
  'piraci:pancernik': { src: url('../src/assets/ships/piratebattleship.png'), len: 28 },
  prom: { src: url('../assets/inter_station_shuttle.png'), len: 14 },
  kontenerowiec: { src: url('../assets/container_ship.png'), len: 21 },
  frachtowiec: { src: url('../assets/long_haul_freighter.png'), len: 22 },
  ciezki: { src: url('../assets/ships/heavy_freighter.png'), len: 25 }
});
const HULL_KEYS = Object.keys(MAP_HULLS);
const ATLAS = Object.freeze({ cols: 4, rows: 3, cellW: 512, cellH: 256, pad: 10 });

/** Ogony: próbki historii, odstęp [s], życie [s], szerokość (× długość statku), prędkość pełnego ogona [ly/s]. */
export const TRAIL = Object.freeze({ samples: 44, every: 0.08, life: 3.4, widthK: 0.15, fullSpeed: 0.07 });
const STRIDE = TRAIL.samples + 2;

/** Eskorta gracza (podgląd floty gracza — klawisz F): przesunięcia względem Atlasa [px przy skali 1]. */
const ESCORT = Object.freeze([
  { key: 'terra:niszczyciel', x: -14, y: -34 },
  { key: 'terra:fregata', x: -16, y: 32 },
  { key: 'terra:fregata', x: -40, y: -14 }
]);

const PLAYER_COLOR = '#79dcff';
const PIRATE_COLOR = '#ff5a4a';

/** Skala ikon statków z przybliżenia (px na ly): lot 190 → 1, cały sektor → 0,42, najbliżej → 1,35. */
export function shipScaleFor(pxPerLy) {
  return Math.min(1.35, Math.max(0.42, Math.sqrt(pxPerLy / 190)));
}

function hexToLinear(hex) {
  const c = new THREE.Color(hex);
  // THREE.Color z hex przy włączonym zarządzaniu barwą jest już liniowy.
  return [c.r, c.g, c.b];
}

/** Szyk floty [px przy skali 1, osie gry]: konwój — kolumna parami, okręty — klin; środek ciężkości w punkcie floty. */
function formation(kind, keys) {
  const lens = keys.map((k) => MAP_HULLS[k].len);
  const maxL = Math.max(...lens);
  const off = keys.map((k, i) => {
    if (i === 0) return [0, 0];
    if (kind === 'trade') {
      const rank = Math.ceil(i / 2);
      const side = i % 2 ? 1 : -1;
      return [-rank * (maxL * 0.95 + 5), side * (maxL * 0.36 + 3)];
    }
    const row = Math.ceil(i / 2);
    const side = i % 2 ? 1 : -1;
    const sp = maxL * 0.62 + 6;
    return [-row * sp, side * row * sp * 0.95];
  });
  const cx = off.reduce((a, o) => a + o[0], 0) / off.length;
  const cy = off.reduce((a, o) => a + o[1], 0) / off.length;
  for (const o of off) { o[0] -= cx; o[1] -= cy; }
  let radius = 0;
  off.forEach((o, i) => { radius = Math.max(radius, Math.sqrt(o[0] * o[0] + o[1] * o[1]) + lens[i] * 0.5); });
  return { off, radius: radius + 5 };
}

export class FleetImage {
  /**
   * @param {THREE.Scene} scene — scena obrazu mapy
   * @param {object} fleets — stan z createFleets
   * @param {object} U — uniformy obrazu (pxPerLy, time)
   */
  constructor(scene, fleets, U) {
    this.scene = scene;
    this.fleets = fleets;
    this.U = U;
    this.shipScale = uniform(1);
    this.rows = fleets.fleets.length + 2;
    this.playerRow = fleets.fleets.length;
    this.escortRow = this.playerRow + 1;
    this.hist = new Float32Array(this.rows * STRIDE * 4);
    this.histAttr = new THREE.StorageBufferAttribute(this.hist, 4);
    this.histNode = storage(this.histAttr, 'vec4', this.rows * STRIDE).toReadOnly().setName('mapaFlotyHistoria');
    this.vis = new Float32Array(this.rows);
    this.sampleAcc = 0;
    this.escort = false;
    this.loaded = false;
    this.cells = new Map();
    this._buildShipList();
    this._buildAtlas();
    this._buildTrails();
    this._buildShips();
  }

  // ── skład i szyk ───────────────────────────────────────────────────────────────────────────────────
  _buildShipList() {
    const ships = [];
    /** Promień kółka floty [px przy skali 1] na wiersz (nakładka 2D). */
    this.rowRadius = new Float32Array(this.rows);
    this.rowColor = [];
    this.fleets.fleets.forEach((f, r) => {
      const fam = f.kind === 'pirate' ? 'piraci' : 'terra';
      const keys = fleetComposition(f).map((c) => (MAP_HULLS[`${fam}:${c}`] ? `${fam}:${c}` : c));
      const { off, radius } = formation(f.kind, keys);
      const col = f.kind === 'pirate' ? PIRATE_COLOR : (FACTIONS[f.faction]?.color || '#9fb4d0');
      this.rowRadius[r] = radius;
      this.rowColor[r] = col;
      const boost = f.kind === 'trade' ? 0.75 : 1.1;
      keys.forEach((k, i) => ships.push({ row: r, key: k, ox: off[i][0], oy: off[i][1], color: col, boost, phase: (r * 2.399 + i * 1.713) % 6.283 }));
    });
    this.rowRadius[this.playerRow] = MAP_HULLS.atlas.len * 0.5 + 6;
    this.rowColor[this.playerRow] = PLAYER_COLOR;
    ships.push({ row: this.playerRow, key: 'atlas', ox: 0, oy: 0, color: PLAYER_COLOR, boost: 1.4, phase: 0.4 });
    ESCORT.forEach((e, i) => ships.push({ row: this.escortRow, key: e.key, ox: e.x, oy: e.y, color: PLAYER_COLOR, boost: 1.0, phase: 1.1 + i * 2.1 }));
    this.rowRadius[this.escortRow] = 0;
    this.rowColor[this.escortRow] = PLAYER_COLOR;
    this.ships = ships;
  }

  // ── atlas sylwetek (ładowany w tle; do końca wczytania sylwetki są puste, ogony już są) ──────────────
  _buildAtlas() {
    const A = ATLAS;
    this.atlasCanvas = document.createElement('canvas');
    this.atlasCanvas.width = A.cols * A.cellW;
    this.atlasCanvas.height = A.rows * A.cellH;
    const tex = new THREE.CanvasTexture(this.atlasCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    this.atlasTex = tex;
    // Komórki z góry (uv rect ustawiany po wczytaniu sprite'a).
    HULL_KEYS.forEach((k, i) => this.cells.set(k, { i, u0: 0, v0: 0, u1: 0, v1: 0, aspect: 0.4 }));
    this.loading = this._loadAtlas().catch((e) => console.error('[mapa-floty] atlas', e));
  }

  async _loadAtlas() {
    const A = ATLAS;
    const ctx = this.atlasCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const W = this.atlasCanvas.width;
    const H = this.atlasCanvas.height;
    await Promise.all(HULL_KEYS.map(async (k) => {
      const img = new Image();
      img.src = MAP_HULLS[k].src;
      await img.decode();
      // Kadr: prostokąt alfy > 8 na pomniejszonej kopii.
      const sw = 320;
      const sh = Math.max(1, Math.round(img.height * sw / img.width));
      const c = document.createElement('canvas');
      c.width = sw;
      c.height = sh;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, sw, sh);
      const d = cx.getImageData(0, 0, sw, sh).data;
      let x0 = sw;
      let y0 = sh;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (d[(y * sw + x) * 4 + 3] > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = sw - 1; y1 = sh - 1; }
      const s = img.width / sw;
      const bx = x0 * s;
      const by = y0 * s;
      const bw = (x1 - x0 + 1) * s;
      const bh = (y1 - y0 + 1) * s;
      const cell = this.cells.get(k);
      const col = cell.i % A.cols;
      const row = Math.floor(cell.i / A.cols);
      const fw = A.cellW - A.pad * 2;
      const fh = A.cellH - A.pad * 2;
      const fit = Math.min(fw / bw, fh / bh);
      const dw = bw * fit;
      const dh = bh * fit;
      const dx = col * A.cellW + (A.cellW - dw) / 2;
      const dy = row * A.cellH + (A.cellH - dh) / 2;
      // Dwa kroki pomniejszenia (z 2–4 tys. px do ~500) — mniej aliasingu niż jeden skok.
      const mid = document.createElement('canvas');
      mid.width = Math.max(1, Math.round(dw * 2));
      mid.height = Math.max(1, Math.round(dh * 2));
      const mx = mid.getContext('2d');
      mx.imageSmoothingQuality = 'high';
      mx.drawImage(img, bx, by, bw, bh, 0, 0, mid.width, mid.height);
      ctx.drawImage(mid, dx, dy, dw, dh);
      Object.assign(cell, { u0: dx / W, v0: dy / H, u1: (dx + dw) / W, v1: (dy + dh) / H, aspect: bh / bw });
    }));
    this.atlasTex.needsUpdate = true;
    // Prostokąty uv i proporcje do atrybutów instancji.
    this.ships.forEach((s, n) => {
      const c = this.cells.get(s.key);
      this.shipB.set([c.u0, c.v0, c.u1, c.v1], n * 4);
      this.shipC[n * 4] = c.aspect;
    });
    this.shipBAttr.needsUpdate = true;
    this.shipCAttr.needsUpdate = true;
    this.loaded = true;
  }

  // ── wspólne węzły: punkt statku w chwili próbki ─────────────────────────────────────────────────────
  /** Kołysanie w szyku [px przy skali 1] z czasu i fazy statku. */
  _wobble(t, ph) {
    return vec2(sin(t.mul(0.71).add(ph)), cos(t.mul(0.53).add(ph.mul(1.7)))).mul(1.6);
  }

  /** Położenie [ly, osie gry] punktu statku (przesunięcie lokalne `loc` w px przy skali 1) w próbce `s`. */
  _shipPoint(s, loc) {
    const k = this.shipScale.div(this.U.pxPerLy);
    const l = loc.mul(k);
    const c = cos(s.z);
    const sn = sin(s.z);
    return vec2(s.x.add(l.x.mul(c)).sub(l.y.mul(sn)), s.y.add(l.x.mul(sn)).add(l.y.mul(c)));
  }

  // ── ogony ──────────────────────────────────────────────────────────────────────────────────────────
  _buildTrails() {
    const K = TRAIL.samples;
    const n = this.ships.length * K;
    const tA = new Float32Array(n * 4);
    const tB = new Float32Array(n * 4);
    const tC = new Float32Array(n * 4);
    this.ships.forEach((s, si) => {
      const len = MAP_HULLS[s.key].len;
      const [r, g, b] = hexToLinear(s.color);
      for (let i = 0; i < K; i++) {
        const o = (si * K + i) * 4;
        tA.set([s.row, s.ox, s.oy, len], o);
        tB.set([i, s.phase, s.boost, 0], o);
        tC.set([r, g, b, 0], o);
      }
    });
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('tA', new THREE.InstancedBufferAttribute(tA, 4));
    geo.setAttribute('tB', new THREE.InstancedBufferAttribute(tB, 4));
    geo.setAttribute('tC', new THREE.InstancedBufferAttribute(tC, 4));
    geo.instanceCount = n;
    const H = this.histNode;
    const vAcross = varyingProperty('float', 'vOgQ');
    const vA = varyingProperty('float', 'vOgA');
    const vHot = varyingProperty('float', 'vOgH');
    const vC = varyingProperty('vec4', 'vOgC');
    const mat = new THREE.NodeMaterial();
    mat.name = 'MapaGwiezdna:ogony';
    // Wstęga (styczna, normalna) po odbiciu osi y do sceny bywa lustrzana — bez cullingu.
    mat.side = THREE.DoubleSide;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.AdditiveBlending;
    mat.positionNode = Fn(() => {
      const a = attribute('tA', 'vec4');
      const b = attribute('tB', 'vec4');
      const q = positionGeometry.xy;
      const base0 = int(a.x).mul(STRIDE).toVar();
      const info = H.element(base0).toVar();
      // q.x = ±1 → koniec 0 / 1 odcinka; indeks punktu wstęgi (0 = teraz, 1… = próbki).
      const idx = int(b.x).add(int(q.x.mul(0.5).add(0.5))).toVar();
      const iP = max(idx.sub(1), int(0)).toVar();
      const iN = min(idx.add(1), int(K)).toVar();
      const s0 = H.element(base0.add(1).add(idx)).toVar();
      const sP = H.element(base0.add(1).add(iP)).toVar();
      const sN = H.element(base0.add(1).add(iN)).toVar();
      // Rufa statku: przesunięcie w szyku + kołysanie z chwili próbki − pół długości wzdłuż kursu.
      const ofs = vec2(a.y, a.z);
      const rear = vec2(a.w.mul(0.47), 0.0);
      const p0 = this._shipPoint(s0, ofs.add(this._wobble(s0.w, b.y)).sub(rear)).toVar();
      const pP = this._shipPoint(sP, ofs.add(this._wobble(sP.w, b.y)).sub(rear));
      const pN = this._shipPoint(sN, ofs.add(this._wobble(sN.w, b.y)).sub(rear));
      const tg = pN.sub(pP).toVar();
      const tl = length(tg);
      const nrm = vec2(tg.y.negate(), tg.x).div(max(tl, 1e-7)).toVar();
      // Wiek punktu i prędkość odcinka (położenia floty bez szyku).
      const age = this.U.time.sub(s0.w);
      const fade = clamp(float(1.0).sub(age.div(TRAIL.life)), 0.0, 1.0).toVar();
      const dtS = max(s0.w.sub(sN.w), 1e-3);
      const spd = length(s0.xy.sub(sN.xy)).div(dtS);
      const moving = smoothstep(TRAIL.fullSpeed * 0.12, TRAIL.fullSpeed, spd);
      const halfW = a.w.mul(TRAIL.widthK).mul(fade.mul(0.65).add(0.35)).mul(this.shipScale.div(this.U.pxPerLy));
      const pos = p0.add(nrm.mul(q.y).mul(halfW));
      vAcross.assign(q.y);
      vA.assign(fade.mul(fade).mul(moving).mul(info.x).mul(info.z.mul(0.7).add(1.0)));
      vHot.assign(fade.mul(fade).mul(fade).mul(fade));
      vC.assign(vec4(attribute('tC', 'vec4').rgb, b.z));
      return vec3(pos.x, pos.y.negate(), 0.0);
    })();
    mat.fragmentNode = Fn(() => {
      const x = abs(vAcross);
      const prof = exp(x.mul(x).mul(-2.6)).mul(float(1.0).sub(smoothstep(0.75, 1.0, x)));
      const core = exp(x.mul(x).mul(-14.0)).mul(vHot).mul(0.45);
      const rgb = vC.rgb.mul(prof).add(vec3(core)).mul(vC.w).mul(vA);
      return vec4(rgb, 1.0);
    })();
    this.trails = new THREE.Mesh(geo, mat);
    this.trails.frustumCulled = false;
    this.trails.renderOrder = -400;
    this.scene.add(this.trails);
  }

  // ── sylwetki i dysze ───────────────────────────────────────────────────────────────────────────────
  _buildShips() {
    const n = this.ships.length;
    const sA = new Float32Array(n * 4);
    this.shipB = new Float32Array(n * 4);
    this.shipC = new Float32Array(n * 4);
    const sD = new Float32Array(n * 4);
    this.ships.forEach((s, i) => {
      sA.set([s.row, s.ox, s.oy, MAP_HULLS[s.key].len], i * 4);
      this.shipC.set([0.4, s.phase, s.boost, 0], i * 4);
      sD.set([...hexToLinear(s.color), 0], i * 4);
    });
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('sA', new THREE.InstancedBufferAttribute(sA, 4));
    this.shipBAttr = new THREE.InstancedBufferAttribute(this.shipB, 4);
    this.shipCAttr = new THREE.InstancedBufferAttribute(this.shipC, 4);
    geo.setAttribute('sB', this.shipBAttr);
    geo.setAttribute('sC', this.shipCAttr);
    geo.setAttribute('sD', new THREE.InstancedBufferAttribute(sD, 4));
    geo.instanceCount = n;
    const H = this.histNode;

    // Sylwetka: kwad długość × (długość · proporcja), obrócony kursem floty.
    {
      const vUv = varyingProperty('vec2', 'vStUv');
      const vV = varyingProperty('float', 'vStV');
      const mat = new THREE.NodeMaterial();
      mat.name = 'MapaGwiezdna:sylwetki';
      mat.transparent = true;
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.forceSinglePass = true;
      mat.blending = THREE.NormalBlending;
      mat.positionNode = Fn(() => {
        const a = attribute('sA', 'vec4');
        const b = attribute('sB', 'vec4');
        const c = attribute('sC', 'vec4');
        const q = positionGeometry.xy;
        const base0 = int(a.x).mul(STRIDE).toVar();
        const info = H.element(base0);
        const live = H.element(base0.add(1)).toVar();
        // y lokalny gry w dół: góra kwadu (q.y = +1, scena w górę) = −y gry.
        const loc = vec2(a.y, a.z).add(this._wobble(live.w, c.y)).add(vec2(q.x.mul(a.w).mul(0.5), q.y.negate().mul(a.w).mul(c.x).mul(0.5)));
        const p = this._shipPoint(live, loc);
        // Atlas: v = 0 u góry obrazu (flipY = false), nos w +u.
        vUv.assign(vec2(mix(b.x, b.z, q.x.mul(0.5).add(0.5)), mix(b.y, b.w, float(0.5).sub(q.y.mul(0.5)))));
        vV.assign(info.x);
        return vec3(p.x, p.y.negate(), 0.0);
      })();
      mat.fragmentNode = Fn(() => {
        const t = texture(this.atlasTex, vUv);
        const rgb = acesGryInv(min(t.rgb.mul(1.1), vec3(0.82)));
        return vec4(rgb, t.a.mul(vV));
      })();
      this.shipMesh = new THREE.Mesh(geo, mat);
      this.shipMesh.frustumCulled = false;
      this.shipMesh.renderOrder = -380;
      this.scene.add(this.shipMesh);
    }

    // Poświata dysz: kwad za rufą, siła z ciągu wiersza (HDR → bloom).
    {
      const vQ = varyingProperty('vec2', 'vDyQ');
      const vI = varyingProperty('float', 'vDyI');
      const vCol = varyingProperty('vec3', 'vDyC');
      const mat = new THREE.NodeMaterial();
      mat.name = 'MapaGwiezdna:dysze';
      mat.transparent = true;
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.forceSinglePass = true;
      mat.blending = THREE.AdditiveBlending;
      mat.positionNode = Fn(() => {
        const a = attribute('sA', 'vec4');
        const c = attribute('sC', 'vec4');
        const q = positionGeometry.xy;
        const base0 = int(a.x).mul(STRIDE).toVar();
        const info = H.element(base0).toVar();
        const live = H.element(base0.add(1)).toVar();
        const r = a.w.mul(info.y.mul(0.1).add(0.09)).mul(info.z.mul(0.35).add(1.0)).toVar();
        const loc = vec2(a.y, a.z).add(this._wobble(live.w, c.y)).add(vec2(a.w.mul(-0.5), 0.0)).add(vec2(q.x, q.y.negate()).mul(r));
        const p = this._shipPoint(live, loc);
        vQ.assign(q);
        vI.assign(info.x.mul(info.y.mul(0.8).add(0.2)).mul(c.z));
        vCol.assign(attribute('sD', 'vec4').rgb);
        return vec3(p.x, p.y.negate(), 0.0);
      })();
      mat.fragmentNode = Fn(() => {
        const r2 = vQ.x.mul(vQ.x).add(vQ.y.mul(vQ.y));
        const k = exp(r2.mul(-5.0)).mul(float(1.0).sub(smoothstep(0.6, 1.0, r2)));
        const hot = exp(r2.mul(-22.0));
        return vec4(vCol.mul(k).add(vec3(hot.mul(0.6))).mul(vI).mul(0.55), 1.0);
      })();
      this.glowMesh = new THREE.Mesh(geo, mat);
      this.glowMesh.frustumCulled = false;
      this.glowMesh.renderOrder = -390;
      this.scene.add(this.glowMesh);
    }
  }

  // ── klatka ─────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Wiersze: widoczność (wygładzona), ciąg, położenie teraz (floty — ekstrapolacja o resztę kroku 10 Hz),
   * próbka co `TRAIL.every` (przesunięcie kolumn), przeskok > 1 ly = nowy ogon.
   */
  update(dt, t, ship, sector, pxPerLy) {
    this.shipScale.value = shipScaleFor(pxPerLy);
    const F = this.fleets;
    const h = this.hist;
    const kv = 1 - Math.exp(-dt * 5);
    const acc = F.acc || 0;
    const writeRow = (r, x, y, hd, visT, thr, burn) => {
      this.vis[r] += (visT - this.vis[r]) * kv;
      if (dt === 0) this.vis[r] = visT;
      const o = r * STRIDE * 4;
      h[o] = this.vis[r];
      h[o + 1] = thr;
      h[o + 2] = burn;
      h[o + 4] = x;
      h[o + 5] = y;
      h[o + 6] = hd;
      h[o + 7] = t;
      // Przeskok (teleport, start): wszystkie próbki w miejscu, martwe.
      const dx = x - h[o + 8];
      const dy = y - h[o + 9];
      if (h[o + 11] === 0 && h[o + 8] === 0 && h[o + 9] === 0 || dx * dx + dy * dy > 1) {
        for (let i = 2; i < STRIDE; i++) h.set([x, y, hd, -1e6], o + i * 4);
      }
    };
    F.fleets.forEach((f, r) => {
      const gone = f.mode === FLEET_MODE.DOCKED || f.mode === FLEET_MODE.GONE;
      const x = gone ? f.x : f.x + f.vx * acc;
      const y = gone ? f.y : f.y + f.vy * acc;
      const sp = Math.sqrt(f.vx * f.vx + f.vy * f.vy) / FLEET_KINDS[f.kind].speed;
      const visT = fleetVisibleToPlayer(f, sector, ship, ship.zone.sensorMul) ? 1 : 0;
      writeRow(r, x, y, f.heading, visT, Math.min(1, sp), 0);
    });
    const thr = Math.min(1, ship.speed / SECTOR_FLIGHT.cruise);
    writeRow(this.playerRow, ship.x, ship.y, ship.heading, 1, thr, ship.burn ? 1 : 0);
    writeRow(this.escortRow, ship.x, ship.y, ship.heading, this.escort ? 1 : 0, thr, ship.burn ? 1 : 0);
    // Próbki historii.
    this.sampleAcc += dt;
    if (this.sampleAcc >= TRAIL.every) {
      this.sampleAcc %= TRAIL.every;
      for (let r = 0; r < this.rows; r++) {
        const o = r * STRIDE * 4;
        h.copyWithin(o + 12, o + 8, o + STRIDE * 4 - 4);
        h[o + 8] = h[o + 4];
        h[o + 9] = h[o + 5];
        h[o + 10] = h[o + 6];
        h[o + 11] = h[o + 7];
      }
    }
    this.histAttr.needsUpdate = true;
  }

  /** Położenie wiersza teraz [ly] i promień kółka [px przy bieżącej skali] — dla nakładki 2D. */
  rowCircle(r, out) {
    const o = r * STRIDE * 4;
    out.x = this.hist[o + 4];
    out.y = this.hist[o + 5];
    out.vis = this.vis[r];
    out.radius = this.rowRadius[r] * this.shipScale.value;
    out.color = this.rowColor[r];
    return out;
  }
}
