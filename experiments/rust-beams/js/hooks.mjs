// Hak ładowania modułów (node:module register): moduły silnika belek z src/ podmienione na wersje spike'u
// (magazyny i bufory w pamięci WASM, jądra z przełącznikiem trybu). Pliki repo zostają nietknięte —
// wersje spike'u ładują oryginał z dopiskiem `?orig`.
const MAP = {
  'beamStore3D.js': 'beamStore3D.mjs',
  'beamConstraintSolver3D.js': 'beamConstraintSolver3D.mjs',
  'beamActiveRegion3D.js': 'beamActiveRegion3D.mjs'
};

export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (!r.url.startsWith('file:') || r.url.includes('?orig')) return r;
  const path = r.url.split('?')[0];
  if (!/\/src\/game\/[^/]+$/.test(path)) return r;
  const base = path.slice(path.lastIndexOf('/') + 1);
  const target = MAP[base];
  if (!target) return r;
  return { ...r, url: new URL(target, import.meta.url).href, shortCircuit: true };
}
