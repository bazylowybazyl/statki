// ============================================================
// Modele broni z Blendera w demie (?bronie=blender, A/B z modelami weapons3D.js). Loader i pliki są w grze:
// src/3d/ships3d/weapons/weaponGlb.js (GLB w assets/weapons3d/, części ring / housing / barrel w jednostkach
// lokalnych wieży, materiały = paleta SHIP3D_MAT → aMat, COLOR_0 → aAO, uv = rzut pudełkowy MeshBuilder3D).
// Tu: geometria części dla Turret dema i materiał broni z AO na świetle pośrednim.
// ============================================================
import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { createShipMaterial } from '../../src/3d/ships3d/shipMaterials3D.tsl.js';
import { parseWeaponGlb, parseWeaponGlbList, weaponGlbFile, weaponGlbUrl } from '../../src/3d/ships3d/weapons/weaponGlb.js';

/**
 * Rodziny z modelem z Blendera w demie (?bronie=blender): plik assets/weapons3d/<plik>.glb (rejestr gry —
 * weaponGlbFile: yamato2 → yamato). Brak pliku = model z weapons3D.js (ostrzeżenie). W GRZE aktywne są tylko
 * rodziny z WEAPON_GLB_GAME (weaponGlb.js) — reszta po akceptacji A/B (?bronieGlb=… w grze).
 */
export const BLENDER_WEAPON_FAMILIES = Object.freeze(['yamato', 'yamato2', 'tempest1', 'tempest2', 'lance', 'deathRay']);

/** Rodzina → adres GLB LOD0 (zgodność wstecz). */
export const BLENDER_WEAPONS = Object.freeze(Object.fromEntries(BLENDER_WEAPON_FAMILIES.map((f) => [f, weaponGlbUrl(f, 0)])));

/** GLB → części w formacie MeshBuilder3D.build() (+ ao). */
export async function loadBlenderWeapon(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return parseWeaponGlb(await r.arrayBuffer(), url);
}

/** BufferGeometry części (position, normal, uv, aMat, aAO). */
export function blenderPartGeometry(d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
  g.setAttribute('aMat', new THREE.BufferAttribute(d.mat, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(d.ao, 1));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Materiał broni dla modeli z Blendera: ten sam graf palety co broń dema + AO z wierzchołków na świetle
 * pośrednim (aoNode: otoczenie PMREM i półkula — słońce bez zmian). aoStrength — mieszanie z 1.
 */
export function createBlenderWeaponMaterial(o = {}) {
  const mat = createShipMaterial({ panelW: 7, panelH: 3.5, name: o.name || 'okręty 3D — broń (Blender)', ...o });
  const k = o.aoStrength ?? 1;
  const ao = attribute('aAO', 'float');
  mat.aoNode = k >= 1 ? ao : ao.mul(k).add(1 - k);
  return mat;
}

/**
 * Wczytuje modele rodzin (lista „rodzina[@lod]”, domyślnie BLENDER_WEAPON_FAMILIES; rodzina → { parts, geo });
 * błąd / brak pliku jednej nie blokuje reszty. o.lod — LOD wpisów bez @ (≥ 1 — wersja uproszczona z tego samego
 * skryptu: scripts/blender/<rodzina>.py --lod 1 → <plik>_lod1.glb).
 */
export async function loadBlenderWeapons(families = BLENDER_WEAPON_FAMILIES, o = {}) {
  const out = {};
  const files = new Map(); // 'plik@lod' → obietnica części (yamato i yamato2 — jeden plik)
  const list = [...parseWeaponGlbList(families.map((f) => (String(f).includes('@') ? f : `${f}@${o.lod || 0}`)))];
  await Promise.all(list.map(async ([fam, lod]) => {
    try {
      const key = `${weaponGlbFile(fam)}@${lod}`;
      if (!files.has(key)) files.set(key, loadBlenderWeapon(weaponGlbUrl(fam, lod)));
      const parts = await files.get(key);
      out[fam] = {
        parts,
        geo: {
          ring: blenderPartGeometry(parts.ring),
          housing: blenderPartGeometry(parts.housing),
          barrel: blenderPartGeometry(parts.barrel),
          spin: parts.spin ? blenderPartGeometry(parts.spin) : null
        }
      };
      const tri = parts.ring.triangleCount + parts.housing.triangleCount + parts.barrel.triangleCount;
      console.info(`[blender] ${fam}${lod ? ` (LOD ${lod})` : ''}: ${tri} trójkątów (pierścień ${parts.ring.triangleCount}, obudowa ${parts.housing.triangleCount}, lufa ${parts.barrel.triangleCount})`);
    } catch (e) {
      console.warn(`[blender] ${fam}: ${e?.message || e} — model z weapons3D.js`);
    }
  }));
  return out;
}
