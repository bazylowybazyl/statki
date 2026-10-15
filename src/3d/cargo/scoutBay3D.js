// src/3d/cargo/scoutBay3D.js
//
// OBRAZ LUKU ATLASA W GRZE (2026-10-11, fregata zwiadu — src/game/scoutBay.js). Ten sam rig co demo ładowni
// (CargoBayRig: wnętrze + wrota kieszeniowe ×3 z wierzchem z wycinka sprite'a — bay.tsl.js, jedno źródło),
// podpięty do Core3D: grupa statku w pozie RENDERU Atlasa, postęp wrót z ScoutBay.door (0…1 → oś przebiegu
// cargoBayDoorTimeline). Fregata w luku jest mniejsza i wynurza się nad Atlasa (scoutFrigateRenderPose). Póki wrota nie są zamknięte, skóra Atlasa (sprite — hexShips3D.tsl.js, slot 22 uBayCut;
// model „Statki 3D” — hullSkin3D.js maskNode) ma w otworze dziurę: entity.__bayCut = prostokąt otworu w uv sprite'a.
// Zamknięte wrota = nic nie rysujemy i skóra jest nietknięta (obraz jak przed ładownią).
//
// Precyzja: grupa w mesh.position (highPrecision — macierz model-widok w double); oświetlenie wnętrza czyta pozycję
// świata float32 (tablica ładowni) — przy 5–10 mln j. ~0,5 j. błędu w świetle lamp, bryła stoi (AGENT: początek
// przy kamerze dla tablicy ładowni, gdy luk dostanie kontenery i drony).
import * as THREE from 'three/webgpu';
import { loadImageBitmap } from '../canvas2d.js';
import { RenderWorld } from '../../render/renderWorld.js';
import { CargoBayRig } from './bay.tsl.js';
import { CARGO_LIGHT, setCargoSun } from './cargoLight.tsl.js';
import { cargoBayDoorTimeline, cargoBayHull, cargoBayScale, cargoHullBays } from '../../data/cargoBays.js';

/** Fregata w luku: wysokość skóry fregaty nad dnem (lift 0) — dno w z = −głębokość. */
export const SCOUT_BAY_FLOOR_CLEAR = 3;

/**
 * Poza renderu fregaty przy starcie i lądowaniu (2026-10-11, prośba użytkownika: „w ładowni mniejsza, przy starcie
 * się powiększa do rozmiaru z gry i jest NAD Atlasem — rysuje się nad nim i nad mostkiem, bez przenikania”).
 * Kamera z góry jest ortograficzna, więc „dalej” = mniejsza skala: na dnie luku `scale0`, po wynurzeniu 1 (rozmiar
 * z gry). Wysokość: dno luku → `aboveZ` nad szczytem brył Atlasa (mostek rufowy ~22 px PNG × 0,48 ≈ 10,6 j.; wieże
 * na sprite'cie do 1,8; dysze SIDE 1,6) i pod efektami (z 14–15). Rozgrywka bez zmian — sam obraz.
 */
export const SCOUT_BAY_LOOK = Object.freeze({
  scale0: 0.62,     // skala fregaty na dnie luku
  aboveZ: 12.5      // z skóry fregaty nad Atlasem (wylot, powrót nad kadłubem, początek lądowania)
});

/**
 * Poza renderu fregaty z fazy ScoutBay. phase / lift — ScoutBay, ghost — fregata jest duchem nad Atlasem,
 * bottomZ — z dna luku (frigateZ(0)). out: { z, scale, lights, engines, turrets } (flagi: true = rysuj).
 */
export function scoutFrigateRenderPose(phase, lift, ghost, bottomZ, out) {
  const L = SCOUT_BAY_LOOK;
  const l = Math.max(0, Math.min(1, Number(lift) || 0));
  out.z = 0; out.scale = 1; out.lights = true; out.engines = true; out.turrets = true;
  if (phase === 'opening' || phase === 'rising' || phase === 'landing') {
    // Wysokość liniowo z wynurzeniem, skala z „perspektywy” (wygładzona — rośnie szybciej przy szczycie luku).
    const e = l * l * (3 - 2 * l);
    out.z = bottomZ + (L.aboveZ - bottomZ) * l;
    out.scale = L.scale0 + (1 - L.scale0) * e;
    out.engines = false;
    out.lights = l >= 0.999;
    // Wrota w ruchu zasłaniają luk — kanwa (wieże) nie zna głębi, więc wieże dopiero przy otwartych wrotach.
    out.turrets = phase !== 'opening';
  } else if (phase === 'departing' || (phase === 'returning' && ghost)) {
    out.z = L.aboveZ;
    out.engines = phase === 'returning';
  }
  return out;
}

export function createScoutBay3D(Core3D, hullId = 'atlas') {
  const H = cargoBayHull(hullId);
  const geo = H ? cargoHullBays(H)[0] : null;
  const B = geo ? geo.bay : null;
  const s = H ? cargoBayScale(H) : 1;
  // Prostokąt otworu w uv sprite'a (u = x / w + ½, v = y / h + ½ — v = 0 u góry obrazka, jak skóra).
  const cut = B ? new THREE.Vector4(
    (B.x - B.w / 2) / H.png.w + 0.5, (B.y - B.h / 2) / H.png.h + 0.5,
    (B.x + B.w / 2) / H.png.w + 0.5, (B.y + B.h / 2) / H.png.h + 0.5) : null;
  // Tekstura wierzchu wrót: zastępcza 1 × 1 (ta sama ścieżka próbkowania — liniowy filtr), potem sprite.
  const placeholder = new THREE.DataTexture(new Uint8Array([60, 64, 70, 255]), 1, 1);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  placeholder.magFilter = THREE.LinearFilter;
  placeholder.minFilter = THREE.LinearFilter;
  placeholder.needsUpdate = true;
  let spriteTex = null;
  let rig = null;
  let group = null;
  const pose = { x: 0, y: 0, angle: 0 };

  let spriteLoading = false;
  function loadSprite() {
    if (spriteTex || spriteLoading || !H || !RenderWorld.isBrowser) return;
    spriteLoading = true;
    loadImageBitmap(H.sprite).then((img) => {
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Core3D.getMaxAnisotropy?.() || 8;
      tex.needsUpdate = true;
      spriteTex = tex;
      if (rig) for (const lf of rig.leaves) lf.mesh.material.uniforms.uSprite.value = tex;
    }, (err) => { spriteLoading = false; console.warn('[scoutBay3D] sprite luku:', err); });
  }

  function ensure() {
    if (rig || !geo || !Core3D.scene) return rig;
    loadSprite();
    group = new THREE.Group();
    group.name = 'ScoutBay3D:atlas';
    group.visible = false;
    Core3D.scene.add(group);
    rig = new CargoBayRig({
      shipGroup: group, geo, spriteTex: spriteTex || placeholder,
      spriteSize: { w: H.png.w * s, h: H.png.h * s }, tableIndex: 0, seed: 0.37
    });
    for (const o of [rig.interior, ...rig.leaves.map((l) => l.mesh)]) o.frustumCulled = false;
    return rig;
  }

  const api = {
    geo,
    cut,
    get rig() { return rig; },
    get group() { return group; },
    /** Głębokość skóry fregaty w luku dla wynurzenia lift 0…1 (z sceny, ≤ 0). */
    frigateZ(lift) {
      if (!geo) return 0;
      const l = Math.max(0, Math.min(1, Number(lift) || 0));
      return -(geo.depth - SCOUT_BAY_FLOOR_CLEAR) * (1 - l);
    },
    /**
     * Klatka renderu. entity — Atlas (dostaje __bayCut), renderPose — poza renderu { x, y, angle } (świat gry),
     * door — 0…1, sun — { x, y } Słońca gry albo null, hidden — maskowanie / brak kadłuba, time — zegar efektów.
     */
    sync(entity, renderPose, door, sun, hidden, time = 0) {
      const d = Math.max(0, Math.min(1, Number(door) || 0));
      if (!entity || !geo || d <= 1e-4 || hidden || !renderPose) {
        if (group) group.visible = false;
        if (entity && entity.__bayCut) entity.__bayCut = null;
        return false;
      }
      ensure();
      if (!rig) return false;
      pose.x = renderPose.x; pose.y = renderPose.y; pose.angle = renderPose.angle || 0;
      group.visible = true;
      group.position.set(pose.x, -pose.y, 0);
      group.rotation.set(0, 0, -pose.angle);
      group.updateMatrixWorld(true);
      rig.update(d * cargoBayDoorTimeline(geo).total, pose);
      entity.__bayCut = cut;
      if (sun) setCargoSun(Math.atan2(-(sun.y - pose.y), sun.x - pose.x));
      CARGO_LIGHT.time.value = time;
      return true;
    },
    /** Rozgrzewka (Core3D.warmup): wnętrze i wszystkie skrzydła w passie ortho. */
    warmupMeshes() {
      ensure();
      return rig ? [rig.interior, ...rig.leaves.map((l) => l.mesh)] : [];
    }
  };
  loadSprite();
  return api;
}
