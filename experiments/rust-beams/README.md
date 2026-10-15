# rust-beams: spike Rust → WASM jąder silnika belek

Raport i wnioski: `docs/SPIKE-rust-wasm-belki.md` (wynik: no-go, ×1,13–1,16 w piku szyi habitatu).

- `src/lib.rs`: jądra `prepare` / `project` (solver lokalny) i `scan` (`_contactCandidates`), wariant A (skalar) i B (simd128).
- `build.mjs`: `pkg/beams_scalar.wasm` i `pkg/beams_simd.wasm` (wymaga rustup + `wasm32-unknown-unknown`).
- `js/`: hak ładowania modułów (`register.mjs`, `hooks.mjs`), alokator pamięci WASM (`runtime.mjs`) i podmienione moduły
  silnika (oryginały z `src/` ładowane przez `?orig`; `beamActiveRegion3D.mjs` to kopia z jedną zmianą: `region.constraints`
  w pamięci WASM, przy zmianie oryginału skopiuj od nowa).
- `bench.mjs`: sceny szyja / taran / ostrzał, tryby JS, A i B na przemian, hash stanu (bit w bit).
- `wyniki/`: surowe wyniki serii z 2026-10-15.

Nic z tego katalogu nie wchodzi do gry ani do paczki Electrona.
