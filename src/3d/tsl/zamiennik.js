// src/3d/tsl/zamiennik.js
//
// Magentowy zamiennik nieprzeniesionych materiałów (docs/webgpu/PLAN.md §2,
// SPIKE.md p. 15). WebGPURenderer nie umie `ShaderMaterial` / `RawShaderMaterial`:
// bez zamiennika three loguje błąd i rysuje pusty NodeMaterial. Po
// `installPlaceholders(renderer)` biblioteka materiałów renderera zamienia je na
// ZamiennikMaterial: magenta ze stanem renderu oryginału (blending, głębia,
// przezroczystość, strona — `fromMaterial` kopiuje pola materiału), wierzchołki
// domyślną ścieżką (billboardy i RTE ringu lądują nie tam, gdzie trzeba — to tylko
// znacznik „do przeniesienia”).
//
// Licznik: ZamiennikMaterial.stats (budowy i nazwy), jedno ostrzeżenie na nazwę
// materiału (nie na klatkę). Oryginał dostaje `isPlaceholder = true` przy pierwszej
// budowie — harness (`spis.zamienniki`) i konsola widzą go w scenie.
import { NodeMaterial } from 'three/webgpu';
import { vec4 } from 'three/tsl';

// Jeden węzeł koloru na wszystkie zamienniki — ten sam klucz programu.
const MAGENTA = vec4(1.0, 0.0, 1.0, 1.0);

const stats = {
  builds: 0,
  byName: new Map()
};

/** Nazwa do spisu: `name` materiału albo pierwsze uniformy (jak `census` harnessu). */
export function placeholderName(material) {
  if (!material) return '?';
  if (material.name) return material.name;
  const keys = material.uniforms ? Object.keys(material.uniforms).slice(0, 3).join('+') : '';
  return keys || material.type || '?';
}

export class ZamiennikMaterial extends NodeMaterial {
  static get type() {
    return 'ZamiennikMaterial';
  }

  constructor() {
    super();
    this.isPlaceholder = true;
    this.lights = false;
    this.fog = false;
  }

  setup(builder) {
    // builder.material = oryginał ze sceny (ten obiekt to jego kopia z biblioteki).
    const source = builder.material;
    const name = placeholderName(source && source !== this ? source : this);
    const type = source?.type || 'ShaderMaterial';
    const key = `${type}:${name}`;
    stats.builds++;
    const seen = stats.byName.get(key) || 0;
    stats.byName.set(key, seen + 1);
    if (seen === 0) {
      console.warn(`[Zamiennik] ${type} „${name}” rysowany magentą — czeka na port TSL`);
    }
    if (source && source !== this && source.isPlaceholder !== true) source.isPlaceholder = true;
    // Graf zamiennika: sam kolor, bez shadera oryginału.
    this.colorNode = MAGENTA;
    this.fragmentNode = null;
    this.vertexNode = null;
    this.outputNode = null;
    this.lights = false;
    this.fog = false;
    return super.setup(builder);
  }

  static get stats() {
    return stats;
  }
}

/** Spis budów zamienników: `{ builds, names: [[klucz, budowy], …] }`. */
export function getPlaceholderStats() {
  return { builds: stats.builds, names: [...stats.byName.entries()] };
}

/**
 * Rejestruje zamiennik dla `ShaderMaterial` i `RawShaderMaterial` w bibliotece
 * materiałów renderera (idempotentnie — druga rejestracja three ostrzega).
 */
export function installPlaceholders(renderer) {
  const library = renderer?.library;
  if (!library || typeof library.addMaterial !== 'function') return false;
  for (const type of ['ShaderMaterial', 'RawShaderMaterial']) {
    if (library.getMaterialNodeClass(type) === null) library.addMaterial(ZamiennikMaterial, type);
  }
  if (typeof window !== 'undefined') window.__zamiennikStats = getPlaceholderStats;
  return true;
}
