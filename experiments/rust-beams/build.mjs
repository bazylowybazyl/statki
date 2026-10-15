// Buduje oba warianty jądra: A (skalar) i B (simd128) → pkg/beams_scalar.wasm, pkg/beams_simd.wasm.
//   node experiments/rust-beams/build.mjs
// Wymaga cargo (rustup, cel wasm32-unknown-unknown). Pamięć importowana z JS (jedna dla obu wariantów).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const cargo = process.env.CARGO || join(homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'cargo.exe' : 'cargo');
mkdirSync(join(here, 'pkg'), { recursive: true });
const link = '-C link-arg=--import-memory -C link-arg=--max-memory=4294967296 -C link-arg=-zstack-size=1048576';
for (const [name, extra] of [['scalar', ''], ['simd', ' -C target-feature=+simd128']]) {
  const target = join(here, 'target', name);
  execFileSync(cargo, ['build', '--release', '--target', 'wasm32-unknown-unknown', '--target-dir', target], {
    cwd: here, stdio: 'inherit', env: { ...process.env, RUSTFLAGS: link + extra }
  });
  const out = join(here, 'pkg', `beams_${name}.wasm`);
  copyFileSync(join(target, 'wasm32-unknown-unknown', 'release', 'rust_beams.wasm'), out);
  console.log(`${name}: ${statSync(out).size} B → ${out}`);
}
