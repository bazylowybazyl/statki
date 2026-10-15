//! Spike: gorące jądra silnika belek (src/game/destructorBeams3D.js, beamConstraintSolver3D.js) w Rust → wasm32.
//!
//! Dane NIE są kopiowane: magazyny SoA, bufory robocze solvera i listy obszaru leżą w pamięci liniowej
//! (importowanej z JS — jedna `WebAssembly.Memory` dla obu wariantów), JS podaje wskaźniki w bloku parametrów.
//!
//! Wariant A (bez `simd128`): ta sama kolejność działań co JS — wynik bit w bit (sqrt i działania IEEE są
//! poprawnie zaokrąglane w obu, Rust nie scala `a*b + c` w FMA, a wasm32 bez relaxed-simd nie ma FMA).
//! Wariant B (`-C target-feature=+simd128`): pary niezależnych belek w pasach f64x2 (rzut Gaussa–Seidla:
//! para belek bez wspólnego węzła liczona naraz daje to samo co po kolei), skan kandydatów kontaktu po dwa
//! węzły. Działania na pasach są te same co skalarne, więc i B jest bit w bit (sprawdza bench.mjs).
// std tylko dla f64::sqrt (→ instrukcja f64.sqrt); bez alokacji i formatowania, LTO zostawia same jądra.
#[inline(always)]
fn sqrt(x: f64) -> f64 {
    x.sqrt()
}

// Math.max / Math.min / Math.sign z JS (NaN i ±0 jak w JS).
#[inline(always)]
fn js_max(a: f64, b: f64) -> f64 {
    if a != a || b != b { return f64::NAN; }
    if a > b { return a; }
    if b > a { return b; }
    if a == 0.0 && (a.is_sign_negative() && b.is_sign_negative()) { return -0.0; }
    if a == 0.0 { return 0.0; }
    a
}
#[inline(always)]
fn js_min(a: f64, b: f64) -> f64 {
    if a != a || b != b { return f64::NAN; }
    if a < b { return a; }
    if b < a { return b; }
    if a == 0.0 && (a.is_sign_negative() || b.is_sign_negative()) { return -0.0; }
    a
}
#[inline(always)]
fn js_sign(x: f64) -> f64 {
    if x > 0.0 { 1.0 } else if x < 0.0 { -1.0 } else { x }
}

#[inline(always)]
unsafe fn f64p(p: *const u32, i: usize) -> *mut f64 { *p.add(i) as usize as *mut f64 }
#[inline(always)]
unsafe fn u32p(p: *const u32, i: usize) -> *mut u32 { *p.add(i) as usize as *mut u32 }
#[inline(always)]
unsafe fn u8p(p: *const u32, i: usize) -> *mut u8 { *p.add(i) as usize as *mut u8 }

/// Pusty eksport — koszt samego przejścia JS → WASM.
#[no_mangle]
pub extern "C" fn noop(x: u32) -> u32 { x }

/// Wersja biblioteki (0 = skalar, 1 = SIMD).
#[no_mangle]
pub extern "C" fn variant() -> u32 {
    if cfg!(target_feature = "simd128") { 1 } else { 0 }
}

// ------------------------------------------------------------------------------------------------
// prepareBeamConstraints
// Parametry u32: 0 positions, 1 weights, 2 active(u8, scratch), 3 mountFailed(u8), 4 outA, 5 outB, 6 outRest,
// 7 outFactor, 8 ea(i32), 9 eb, 10 broken(u8), 11 type(u8), 12 rest, 13 restBase, 14 deform, 15 brk, 16 strain,
// 17 fatigue, 18 stiffness, 19 list(i32, 0 = wszystkie), 20 total, 21 breakOn, 22 flat; wynik: 30 count, 31 deformed.
// Parametry f64: 0 stiffMul, 1 breakMul, 2 plasticFatigue, 3 driftLo, 4 driftHi, 5 dt, 6 plasticRate, 7 stepScaleSq.
// ------------------------------------------------------------------------------------------------
#[no_mangle]
pub unsafe extern "C" fn prepare(pi: *mut u32, pf: *const f64) -> u32 {
    let p = f64p(pi, 0);
    let w = f64p(pi, 1);
    let active = u8p(pi, 2);
    let mount_failed = u8p(pi, 3);
    let out_a = u32p(pi, 4);
    let out_b = u32p(pi, 5);
    let out_rest = f64p(pi, 6);
    let out_factor = f64p(pi, 7);
    let ea = u32p(pi, 8);
    let eb = u32p(pi, 9);
    let broken = u8p(pi, 10);
    let typ = u8p(pi, 11);
    let rest_arr = f64p(pi, 12);
    let rest_base = f64p(pi, 13);
    let deform = f64p(pi, 14);
    let brk = f64p(pi, 15);
    let strain_arr = f64p(pi, 16);
    let fatigue = f64p(pi, 17);
    let stiffness_arr = f64p(pi, 18);
    let list = u32p(pi, 19);
    let has_list = *pi.add(19) != 0;
    let total = *pi.add(20) as usize;
    let break_on = *pi.add(21) == 1;
    let flat = *pi.add(22) != 0;
    let stiff_mul = *pf.add(0);
    let break_mul = *pf.add(1);
    let plastic_fatigue = *pf.add(2);
    let drift_lo = *pf.add(3);
    let drift_hi = *pf.add(4);
    let dt = *pf.add(5);
    let plastic_rate = *pf.add(6);
    let step_scale_sq = *pf.add(7);

    let (mut ks0, mut kk0, mut ks1, mut kk1, mut ks2, mut kk2, mut ks3, mut kk3) =
        (f64::NAN, 0.0f64, f64::NAN, 0.0f64, f64::NAN, 0.0f64, f64::NAN, 0.0f64);
    let mut count: usize = 0;
    let mut broken_now: u32 = 0;
    let mut deformed = false;

    // Długości belek (zależą tylko od pozycji — prepare ich nie zmienia): w B liczone parami.
    let mut k = 0usize;
    while k < total {
        #[cfg(target_feature = "simd128")]
        let (len0, len1, n) = {
            use core::arch::wasm32::*;
            if k + 1 < total {
                let e0 = if has_list { *list.add(k) as usize } else { k };
                let e1 = if has_list { *list.add(k + 1) as usize } else { k + 1 };
                let (a0, b0) = (*ea.add(e0) as usize * 3, *eb.add(e0) as usize * 3);
                let (a1, b1) = (*ea.add(e1) as usize * 3, *eb.add(e1) as usize * 3);
                let dx = f64x2_sub(f64x2(*p.add(b0), *p.add(b1)), f64x2(*p.add(a0), *p.add(a1)));
                let dy = f64x2_sub(f64x2(*p.add(b0 + 1), *p.add(b1 + 1)), f64x2(*p.add(a0 + 1), *p.add(a1 + 1)));
                let mut s2 = f64x2_add(f64x2_mul(dx, dx), f64x2_mul(dy, dy));
                if !flat {
                    let dz = f64x2_sub(f64x2(*p.add(b0 + 2), *p.add(b1 + 2)), f64x2(*p.add(a0 + 2), *p.add(a1 + 2)));
                    s2 = f64x2_add(s2, f64x2_mul(dz, dz));
                }
                let l = f64x2_sqrt(s2);
                (f64x2_extract_lane::<0>(l), f64x2_extract_lane::<1>(l), 2usize)
            } else {
                (f64::NAN, f64::NAN, 1usize)
            }
        };
        #[cfg(not(target_feature = "simd128"))]
        let (len0, len1, n) = (f64::NAN, f64::NAN, 1usize);

        for lane in 0..n {
            let kk_i = k + lane;
            let e = if has_list { *list.add(kk_i) as usize } else { kk_i };
            let a = *ea.add(e) as usize;
            let b = *eb.add(e) as usize;
            if *broken.add(e) != 0 || *active.add(a) == 0 || *active.add(b) == 0 { continue; }
            if break_on && *typ.add(e) >= 2 && (*mount_failed.add(a) != 0 || *mount_failed.add(b) != 0) {
                *broken.add(e) = 1;
                broken_now += 1;
                continue;
            }
            let len = if n == 2 {
                if lane == 0 { len0 } else { len1 }
            } else {
                let ia = a * 3;
                let ib = b * 3;
                let dx = *p.add(ib) - *p.add(ia);
                let dy = *p.add(ib + 1) - *p.add(ia + 1);
                if flat {
                    sqrt(dx * dx + dy * dy)
                } else {
                    let dz = *p.add(ib + 2) - *p.add(ia + 2);
                    sqrt(dx * dx + dy * dy + dz * dz)
                }
            };
            let rest = *rest_arr.add(e);
            let base = *rest_base.add(e);
            let def = *deform.add(e);
            let c = len - rest;
            let strain = c / rest;
            let abs_strain = strain.abs();
            *strain_arr.add(e) = strain;
            if break_on {
                let limit = *brk.add(e) * break_mul;
                if abs_strain > def {
                    let f = *fatigue.add(e);
                    let f = if f != f || f == 0.0 { 0.0 } else { f };
                    *fatigue.add(e) = f + (abs_strain - def) / limit * plastic_fatigue * dt * 60.0;
                }
                if js_max(abs_strain, (len - base).abs() / base) > limit || *fatigue.add(e) >= 1.0 {
                    *broken.add(e) = 1;
                    broken_now += 1;
                    continue;
                }
            }
            if abs_strain > def {
                let over = c - js_sign(c) * def * rest;
                *rest_arr.add(e) = js_max(base * drift_lo, js_min(base * drift_hi, rest + over * plastic_rate));
                deformed = true;
            }
            let wsum = *w.add(a) + *w.add(b);
            if wsum <= 0.0 { continue; }
            let stiffness = js_min(1.0, *stiffness_arr.add(e) * stiff_mul);
            let kk;
            if stiffness == ks0 { kk = kk0; }
            else if stiffness == ks1 { kk = kk1; }
            else if stiffness == ks2 { kk = kk2; }
            else if stiffness == ks3 { kk = kk3; }
            else {
                kk = stiffness / (stiffness + (1.0 - stiffness) / step_scale_sq);
                if stiffness > 0.0 { ks3 = ks2; kk3 = kk2; ks2 = ks1; kk2 = kk1; ks1 = ks0; kk1 = kk0; ks0 = stiffness; kk0 = kk; }
            }
            *out_a.add(count) = a as u32;
            *out_b.add(count) = b as u32;
            *out_rest.add(count) = *rest_arr.add(e);
            *out_factor.add(count) = kk / wsum;
            count += 1;
        }
        k += n;
    }
    *pi.add(30) = count as u32;
    *pi.add(31) = deformed as u32;
    broken_now
}

// ------------------------------------------------------------------------------------------------
// projectBeamConstraints / projectBeamConstraints2D (Gauss–Seidel)
// Parametry u32: 0 positions, 1 weights, 4 a, 5 b, 6 rest, 7 factor (jak w prepare), 30 count.
// ------------------------------------------------------------------------------------------------
#[no_mangle]
pub unsafe extern "C" fn project(pi: *const u32, iterations: u32, flat: u32) -> u32 {
    let p = f64p(pi, 0);
    let w = f64p(pi, 1);
    let ca = u32p(pi, 4);
    let cb = u32p(pi, 5);
    let rest = f64p(pi, 6);
    let factor = f64p(pi, 7);
    let count = *pi.add(30) as usize;
    if flat != 0 { project_impl::<true>(p, w, ca, cb, rest, factor, count, iterations) }
    else { project_impl::<false>(p, w, ca, cb, rest, factor, count, iterations) }
}

#[inline(always)]
unsafe fn project_one<const FLAT: bool>(p: *mut f64, w: *const f64, na: usize, nb: usize, rest: f64, factor: f64) -> bool {
    let ia = na * 3;
    let ib = nb * 3;
    let dx = *p.add(ib) - *p.add(ia);
    let dy = *p.add(ib + 1) - *p.add(ia + 1);
    let (len, dz) = if FLAT {
        (sqrt(dx * dx + dy * dy), 0.0)
    } else {
        let dz = *p.add(ib + 2) - *p.add(ia + 2);
        (sqrt(dx * dx + dy * dy + dz * dz), dz)
    };
    if len < 1e-9 { return false; }
    let corr = ((len - rest) / len) * factor;
    let cx = dx * corr;
    let cy = dy * corr;
    let wa = *w.add(na);
    let wb = *w.add(nb);
    *p.add(ia) += cx * wa;
    *p.add(ia + 1) += cy * wa;
    *p.add(ib) -= cx * wb;
    *p.add(ib + 1) -= cy * wb;
    if !FLAT {
        let cz = dz * corr;
        *p.add(ia + 2) += cz * wa;
        *p.add(ib + 2) -= cz * wb;
    }
    true
}

#[cfg(not(target_feature = "simd128"))]
unsafe fn project_impl<const FLAT: bool>(p: *mut f64, w: *const f64, ca: *const u32, cb: *const u32,
    rest: *const f64, factor: *const f64, count: usize, iterations: u32) -> u32 {
    let mut solved = 0u32;
    for _ in 0..iterations {
        for j in 0..count {
            if project_one::<FLAT>(p, w, *ca.add(j) as usize, *cb.add(j) as usize, *rest.add(j), *factor.add(j)) {
                solved += 1;
            }
        }
    }
    solved
}

#[cfg(target_feature = "simd128")]
unsafe fn project_impl<const FLAT: bool>(p: *mut f64, w: *const f64, ca: *const u32, cb: *const u32,
    rest: *const f64, factor: *const f64, count: usize, iterations: u32) -> u32 {
    use core::arch::wasm32::*;
    let mut solved = 0u32;
    for _ in 0..iterations {
        let mut j = 0usize;
        while j < count {
            let na0 = *ca.add(j) as usize;
            let nb0 = *cb.add(j) as usize;
            if j + 1 < count {
                let na1 = *ca.add(j + 1) as usize;
                let nb1 = *cb.add(j + 1) as usize;
                // Para bez wspólnego węzła: druga belka nie czyta tego, co pisze pierwsza — naraz = po kolei.
                if na0 != na1 && na0 != nb1 && nb0 != na1 && nb0 != nb1 {
                    let (ia0, ib0, ia1, ib1) = (na0 * 3, nb0 * 3, na1 * 3, nb1 * 3);
                    let dx = f64x2_sub(f64x2(*p.add(ib0), *p.add(ib1)), f64x2(*p.add(ia0), *p.add(ia1)));
                    let dy = f64x2_sub(f64x2(*p.add(ib0 + 1), *p.add(ib1 + 1)), f64x2(*p.add(ia0 + 1), *p.add(ia1 + 1)));
                    let dz = if FLAT { f64x2_splat(0.0) } else {
                        f64x2_sub(f64x2(*p.add(ib0 + 2), *p.add(ib1 + 2)), f64x2(*p.add(ia0 + 2), *p.add(ia1 + 2)))
                    };
                    let mut s2 = f64x2_add(f64x2_mul(dx, dx), f64x2_mul(dy, dy));
                    if !FLAT { s2 = f64x2_add(s2, f64x2_mul(dz, dz)); }
                    let len = f64x2_sqrt(s2);
                    let r = f64x2(*rest.add(j), *rest.add(j + 1));
                    let fac = f64x2(*factor.add(j), *factor.add(j + 1));
                    let corr = f64x2_mul(f64x2_div(f64x2_sub(len, r), len), fac);
                    let cx = f64x2_mul(dx, corr);
                    let cy = f64x2_mul(dy, corr);
                    let wa = f64x2(*w.add(na0), *w.add(na1));
                    let wb = f64x2(*w.add(nb0), *w.add(nb1));
                    let ax = f64x2_mul(cx, wa);
                    let ay = f64x2_mul(cy, wa);
                    let bx = f64x2_mul(cx, wb);
                    let by = f64x2_mul(cy, wb);
                    let ok0 = !(f64x2_extract_lane::<0>(len) < 1e-9);
                    let ok1 = !(f64x2_extract_lane::<1>(len) < 1e-9);
                    if ok0 {
                        *p.add(ia0) += f64x2_extract_lane::<0>(ax);
                        *p.add(ia0 + 1) += f64x2_extract_lane::<0>(ay);
                        *p.add(ib0) -= f64x2_extract_lane::<0>(bx);
                        *p.add(ib0 + 1) -= f64x2_extract_lane::<0>(by);
                        solved += 1;
                    }
                    if ok1 {
                        *p.add(ia1) += f64x2_extract_lane::<1>(ax);
                        *p.add(ia1 + 1) += f64x2_extract_lane::<1>(ay);
                        *p.add(ib1) -= f64x2_extract_lane::<1>(bx);
                        *p.add(ib1 + 1) -= f64x2_extract_lane::<1>(by);
                        solved += 1;
                    }
                    if !FLAT {
                        let cz = f64x2_mul(dz, corr);
                        let az = f64x2_mul(cz, wa);
                        let bz = f64x2_mul(cz, wb);
                        if ok0 {
                            *p.add(ia0 + 2) += f64x2_extract_lane::<0>(az);
                            *p.add(ib0 + 2) -= f64x2_extract_lane::<0>(bz);
                        }
                        if ok1 {
                            *p.add(ia1 + 2) += f64x2_extract_lane::<1>(az);
                            *p.add(ib1 + 2) -= f64x2_extract_lane::<1>(bz);
                        }
                    }
                    j += 2;
                    continue;
                }
            }
            if project_one::<FLAT>(p, w, na0, nb0, *rest.add(j), *factor.add(j)) { solved += 1; }
            j += 1;
        }
    }
    solved
}

// ------------------------------------------------------------------------------------------------
// _contactCandidates — skan węzłów iterowanego ciała (prolog z macierzami zostaje w JS).
// Parametry u32: 0 x, 1 y, 2 z, 3 active(u8), 4 out list(i32), 5 start, 6 total.
// Parametry f64: 0 rx0, 1 rx1, 2 ry0, 3 ry1, 4 rz0, 5 rz1.
// ------------------------------------------------------------------------------------------------
#[no_mangle]
pub unsafe extern "C" fn scan(pi: *const u32, pf: *const f64) -> u32 {
    let x = f64p(pi, 0) as *const f64;
    let y = f64p(pi, 1) as *const f64;
    let z = f64p(pi, 2) as *const f64;
    let active = u8p(pi, 3) as *const u8;
    let out = u32p(pi, 4);
    let start = *pi.add(5) as usize;
    let total = *pi.add(6) as usize;
    let b = [*pf.add(0), *pf.add(1), *pf.add(2), *pf.add(3), *pf.add(4), *pf.add(5)];
    let m = scan_range(x, y, z, active, out, 0, start, total, &b);
    scan_range(x, y, z, active, out, m, 0, start, &b) as u32
}

#[inline(always)]
unsafe fn scan_one(x: *const f64, y: *const f64, z: *const f64, n: usize, b: &[f64; 6]) -> bool {
    let px = *x.add(n);
    let py = *y.add(n);
    let pz = *z.add(n);
    !(px < b[0] || px > b[1] || py < b[2] || py > b[3] || pz < b[4] || pz > b[5])
}

#[cfg(not(target_feature = "simd128"))]
unsafe fn scan_range(x: *const f64, y: *const f64, z: *const f64, active: *const u8, out: *mut u32,
    mut m: usize, from: usize, to: usize, b: &[f64; 6]) -> usize {
    for n in from..to {
        if *active.add(n) == 0 { continue; }
        if scan_one(x, y, z, n, b) { *out.add(m) = n as u32; m += 1; }
    }
    m
}

#[cfg(target_feature = "simd128")]
unsafe fn scan_range(x: *const f64, y: *const f64, z: *const f64, active: *const u8, out: *mut u32,
    mut m: usize, from: usize, to: usize, b: &[f64; 6]) -> usize {
    use core::arch::wasm32::*;
    let (x0, x1) = (f64x2_splat(b[0]), f64x2_splat(b[1]));
    let (y0, y1) = (f64x2_splat(b[2]), f64x2_splat(b[3]));
    let (z0, z1) = (f64x2_splat(b[4]), f64x2_splat(b[5]));
    let mut n = from;
    while n + 2 <= to {
        // Ten sam test co skalarny: !(p < lo || p > hi) — węzeł z NaN przechodzi jak w JS.
        let vx = v128_load(x.add(n) as *const v128);
        let vy = v128_load(y.add(n) as *const v128);
        let vz = v128_load(z.add(n) as *const v128);
        let out_of = v128_or(
            v128_or(v128_or(f64x2_lt(vx, x0), f64x2_gt(vx, x1)), v128_or(f64x2_lt(vy, y0), f64x2_gt(vy, y1))),
            v128_or(f64x2_lt(vz, z0), f64x2_gt(vz, z1)));
        let mask = !i64x2_bitmask(out_of) & 3;
        if mask != 0 {
            if mask & 1 != 0 && *active.add(n) != 0 { *out.add(m) = n as u32; m += 1; }
            if mask & 2 != 0 && *active.add(n + 1) != 0 { *out.add(m) = (n + 1) as u32; m += 1; }
        }
        n += 2;
    }
    while n < to {
        if *active.add(n) != 0 && scan_one(x, y, z, n, b) { *out.add(m) = n as u32; m += 1; }
        n += 1;
    }
    m
}
