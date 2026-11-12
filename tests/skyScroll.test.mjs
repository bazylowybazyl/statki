// Obrót sfery nieba z drogi statku (src/3d/skyScroll.js, DECYZJE-2 N1): PRAWO TEMPA (2026-10-27 — droga nieba vN liniowa
// do kolana i logarytmiczna wyżej, wygładzona, p 0,1; dawne prawo `?nieboTempo=stare`), hierarchia warstw W0 w stanie
// ustalonym i w przejściach, drobne gwiazdy (próg w px / klatkę), smuga jasnych gwiazd, parametr adresu, znak obrotu,
// cięcie przy teleporcie, rzut równoodległy (lustro CPU materiału), orientacja startowa, holonomia.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKY_SCROLL, SKY_SCROLL_STARE, SKY_START, skyFocalPx, skyScreenSpeed, skyDriveSpeed, skyFineStarsGain, skyFineStarsGainPx,
  stepSkyFineGain, createSkyScroll, resetSkyScroll, stepSkyScroll, createSkyTrack, skyTrackStep, skyScrollMove, skyViewMatrix,
  skyWorldMatrix, quatToMat3, mat3AngleBetween, skyEquidistantDir, skyEquidistantPx, skyLayerSpeeds, skyDirFromLonLat,
  skyEquirectUvCpu, skyStartQuat, skyTempoFrom, skyTempoTune, skyMidDriveMul, skyStarStreakPx, skyParallax,
  SKY_SCROLL_BEZ_SUFITU
} from '../src/3d/skyScroll.js';
import { readFileSync } from 'node:fs';
import { STAR_PARALLAX_LAYERS, STAR_MID_SPHERE } from '../src/3d/starParallax.js';
import { WARP_DRIVES, HYPERCRUISE_ENGINES, HYPERCRUISE_TUNE } from '../src/data/driveModes.js';
import { WARP_TRIP, warpTripTuneFor, WARP_SLOW_FLOOR } from '../src/game/warpDrive.js';

const DEG = Math.PI / 180;
const mulV = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const mulTV = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
const F1080 = skyFocalPx(1080);
const F1440 = skyFocalPx(1440);

// Kadry: zoom domyślny Atlasa 0,2133 przy 1920 px CSS szerokości (cameraRig.js: defaultShipZoom = 0,2 · W / 1800 — zoom ∝
// SZEROKOŚĆ kadru, więc 32:9 ma 2× zoom przy tej samej wysokości), kadr skoku i hipercruise'u × 0,55.
const zoomRef = (w) => 0.2 * w / 1800;
const ZOOM_REF = zoomRef(1920);
const ZOOM_JUMP = ZOOM_REF * 0.55;
const SCREENS = Object.freeze([
  { name: '1080p 16:9', w: 1920, h: 1080 },
  { name: '1440p 16:9', w: 2560, h: 1440 },
  { name: '1080p 32:9', w: 3840, h: 1080 },
  { name: '1440p 32:9', w: 5120, h: 1440 }
]);
const vWarpMax = (id) => warpTripTuneFor(WARP_DRIVES[id].speed, WARP_TRIP).vMax;
// Tryby lotu: v [j/s], zoom jako ułamek zoomu domyślnego (kadr).
export const SKY_MODES = Object.freeze([
  { name: 'walka 300', v: 300, k: 1 },
  { name: 'walka 507 (Atlas)', v: 507, k: 1 },
  { name: 'walka 800', v: 800, k: 1 },
  { name: 'dopalacz 1137', v: 1137, k: 1 },
  { name: 'walka 1500', v: 1500, k: 1 },
  { name: 'walka z bliska 1137 (zoom 0,45)', v: 1137, k: 0.45 / ZOOM_REF },
  { name: 'walka z daleka 507 (zoom 0,1)', v: 507, k: 0.1 / ZOOM_REF },
  { name: 'hipercruise Mk I przy planecie (× 0,6)', v: HYPERCRUISE_ENGINES.hypercruise_mk1.vmax * HYPERCRUISE_TUNE.minZone, k: 0.55 },
  { name: 'hipercruise Mk I', v: HYPERCRUISE_ENGINES.hypercruise_mk1.vmax, k: 0.55 },
  { name: 'hipercruise Mk II', v: HYPERCRUISE_ENGINES.hypercruise_mk2.vmax, k: 0.55 },
  { name: 'hipercruise Mk III', v: HYPERCRUISE_ENGINES.hypercruise_mk3.vmax, k: 0.55 },
  { name: 'warp Mk II nad planetą (podłoga 0,15)', v: 225000 * WARP_SLOW_FLOOR, k: 0.55 },
  { name: 'warp Mk I', v: WARP_DRIVES.warp_mk1.speed, k: 0.55 },
  { name: 'warp Mk II', v: WARP_DRIVES.warp_mk2.speed, k: 0.55 },
  { name: 'warp Mk III', v: WARP_DRIVES.warp_mk3.speed, k: 0.55 },
  { name: 'warp Mk III sufit planu', v: vWarpMax('warp_mk3'), k: 0.55 },
  { name: 'ślizg wyjścia (16,2 tys., kadr przylotu 0,1)', v: 16200, k: 0.1 },
  { name: 'koniec ślizgu (16,2 tys., zoom bojowy)', v: 16200, k: 1 }
]);

test('f kamery z góry: 1080p ≈ 1712,7 px/rad (FOV 35°)', () => {
  assert.ok(Math.abs(F1080 - 1712.7) < 0.1, String(F1080));
});

test('prawo tempa: droga nieba liniowa do kolana, logarytm wyżej — ciągła, gładka, rosnąca; dawne prawo = sufit 14 tys.', () => {
  const k = SKY_SCROLL.knee;
  assert.equal(k, 5000);
  // samo prawo kolana (bez członu zwykłego lotu)
  const K = { ...SKY_SCROLL, cruiseBoost: 1 };
  for (const v of [0, 1, 300, 507, 1137, 1500, 4999, 5000]) assert.equal(skyDriveSpeed(v, K), v, `liniowo ${v}`);
  // ciągła i gładka w kolanie (pochodna 1 z obu stron)
  const e = 1e-3;
  assert.ok(Math.abs(skyDriveSpeed(k + e, K) - (k + e)) < 1e-6);
  assert.ok(Math.abs((skyDriveSpeed(k + 2 * e, K) - skyDriveSpeed(k + e, K)) / e - 1) < 1e-3);
  // człon zwykłego lotu (2026-10-31, „lepszy efekt prędkości”): vN += (B − 1) · v · (1 − v / to)² poniżej to — przy małej
  // prędkości × 2,5, walka 507 × 2,32, dopalacz × 2,10; od cruiseTo prawo kolana bez zmian (hipercruise, warp)
  const B = SKY_SCROLL.cruiseBoost, to = SKY_SCROLL.cruiseTo;
  assert.equal(B, 2.5);
  assert.equal(to, 8000);
  for (const v of [0, 1, 300, 507, 1137, 1500, 4999, 5000, 6500]) {
    const r = 1 - v / to;
    assert.ok(Math.abs(skyDriveSpeed(v) - (skyDriveSpeed(v, K) + (B - 1) * v * r * r)) < 1e-9, `zwykły lot ${v}`);
  }
  assert.ok(Math.abs(skyDriveSpeed(507) / 507 - 2.316) < 0.002 && Math.abs(skyDriveSpeed(1137) / 1137 - 2.104) < 0.002);
  for (const v of [to, 8001, 20000, 175000]) assert.equal(skyDriveSpeed(v), skyDriveSpeed(v, K), `bez członu od cruiseTo: ${v}`);
  // rosnąca w zwykłym locie (pochodna ≥ ~0,36 — przy cruiseTo gładko: człon ma tam zerową pochodną), nigdy ponad B · v
  let prev = 0;
  for (let v = 10; v <= 9000; v += 10) {
    const d = skyDriveSpeed(v);
    assert.ok(d - prev >= 0.3 * 10 && d <= B * v + 1e-9, `${v}: ${d}`);
    prev = d;
  }
  // rosnąca bez sufitu: hipercruise < warp, Mk I < Mk II < Mk III
  let last = -1;
  for (const v of [5000, 8000, 20000, 30000, 40000, 100000, 175000, 250000, 400000, 600000]) {
    const d = skyDriveSpeed(v);
    assert.ok(d > last && (d <= v || v < to), `${v}: ${d}`);
    last = d;
  }
  assert.ok(Math.abs(skyDriveSpeed(20000) - 11931.5) < 1 && Math.abs(skyDriveSpeed(175000) - 22776.7) < 1);
  // dawne prawo
  assert.equal(skyDriveSpeed(507, SKY_SCROLL_STARE), 507);
  assert.equal(skyDriveSpeed(175000, SKY_SCROLL_STARE), 14000);
  assert.equal(SKY_SCROLL_STARE.p, 0.03);
});

test('liczby tempa [px/s, °/s]: walka 3,3× dawniej, hipercruise ≫ walka, warp > hipercruise (dawniej równe), Mk I < II < III', () => {
  const sp = (v, zoom, tune = SKY_SCROLL) => skyScreenSpeed(v, zoom, tune);
  // walka (1080p, zoom 0,2133): 507 j/s → 25,1 px/s (bez członu zwykłego lotu 10,8; dawniej 3,24) — 7,7×
  assert.ok(Math.abs(sp(507, ZOOM_REF) - 25.05) < 0.03, String(sp(507, ZOOM_REF)));
  assert.ok(Math.abs(sp(507, ZOOM_REF, { ...SKY_SCROLL, cruiseBoost: 1 }) - 10.81) < 0.02);
  assert.ok(Math.abs(sp(507, ZOOM_REF, SKY_SCROLL_STARE) - 3.24) < 0.01);
  const ratio = sp(1137, ZOOM_REF) / sp(1137, ZOOM_REF, SKY_SCROLL_STARE);
  assert.ok(ratio > 6.5 && ratio < 7.5, `walka ×${ratio.toFixed(2)}`);
  // hipercruise i warp w kadrze skoku (zoom 0,1173)
  const hc1 = sp(20000, ZOOM_JUMP), hc3 = sp(40000, ZOOM_JUMP);
  const w1 = sp(100000, ZOOM_JUMP), w2 = sp(175000, ZOOM_JUMP), w3 = sp(250000, ZOOM_JUMP);
  assert.ok(Math.abs(hc1 - 140.0) < 0.5 && Math.abs(hc3 - 180.6) < 0.5, `${hc1} ${hc3}`);
  assert.ok(Math.abs(w2 - 267.2) < 0.5, String(w2));
  // hipercruise wyraźnie szybciej niż walka (×2,2 wobec walki 1500 j/s z członem zwykłego lotu — dawniej ×4,4)
  assert.ok(hc1 > 2 * sp(1500, ZOOM_REF), 'hipercruise wyraźnie szybciej niż walka');
  assert.ok(hc1 < hc3 && hc3 < w1 && w1 < w2 && w2 < w3, 'Mk I < Mk III hipercruise < warp Mk I < II < III');
  assert.ok(w2 / hc1 > 1.8, `warp Mk II / hipercruise Mk I ×${(w2 / hc1).toFixed(2)}`);
  // dawniej hipercruise i warp na suficie (49,3 px/s)
  assert.ok(Math.abs(sp(20000, ZOOM_JUMP, SKY_SCROLL_STARE) - sp(250000, ZOOM_JUMP, SKY_SCROLL_STARE)) < 1e-9);
  // °/s: 16:9 ta sama prędkość kątowa przy 1080p i 1440p (zoom ∝ szerokość, f ∝ wysokość); 32:9 — 2×
  const deg = (v, scr, k) => skyScreenSpeed(v, zoomRef(scr.w) * k) / skyFocalPx(scr.h) / DEG;
  const [s1080, s1440, w1080, w1440] = SCREENS;
  assert.ok(Math.abs(deg(175000, s1080, 0.55) - deg(175000, s1440, 0.55)) < 1e-9);
  assert.ok(Math.abs(deg(175000, w1440, 0.55) / deg(175000, s1440, 0.55) - 2) < 1e-9);
  assert.ok(Math.abs(deg(175000, s1080, 0.55) - 8.94) < 0.02, `warp Mk II ${deg(175000, s1080, 0.55)} °/s`);
  // 32:9 w walce bez sufitu głębi: 0,72 °/s × człon zwykłego lotu (× 2,32)
  assert.ok(Math.abs(deg(507, w1080, 1) - 1.668) < 0.01, String(deg(507, w1080, 1)));
});

test('W0 (stan ustalony): niebo < mid < speed GameStars we wszystkich trybach lotu, ekranach i przy ?nieboTempo', () => {
  // Pilnuje warstw GameStars (starParallax.js): niebo względem gwiazd. Skał pasa w skoku nie ma (usunięte 2026-10-27,
  // decyzja użytkownika) — hierarchia W0 to niebo < mid < speed.
  // Tryb sfery: mid jedzie drogą nieba z paralaksą STAR_MID_SPHERE (najwolniejsza mid ≥ 1,3 × niebo), speed — kamerą;
  // z f — sufit głębi nieba i skala ekranowa warstw GameStars na z = −250 (camZ / (camZ + 250) ≥ 0,94 w tych kadrach).
  assert.ok(STAR_MID_SPHERE.parallaxMin >= SKY_SCROLL.p * 1.3 - 1e-12, 'najwolniejsza mid ≥ 1,3 × niebo');
  let worst = 0;
  for (const mul of [1, 0.5, 1.5]) {
    for (const scr of SCREENS) {
      for (const m of SKY_MODES) {
        const s = skyLayerSpeeds(m.v, zoomRef(scr.w) * m.k, SKY_SCROLL, mul, skyFocalPx(scr.h));
        worst = Math.max(worst, s.sky / s.mid[0]);
        assert.ok(s.sky * 1.2 < s.mid[0], `×${mul} ${scr.name} ${m.name}: niebo ${s.sky.toFixed(1)} < mid ${s.mid[0].toFixed(1)}`);
        assert.ok(s.mid[1] < s.speed[0], `×${mul} ${scr.name} ${m.name}: mid ${s.mid[1].toFixed(1)} < speed ${s.speed[0].toFixed(1)}`);
      }
    }
  }
  assert.ok(worst < 0.8, `niebo / najwolniejsza mid ≤ ${worst.toFixed(3)} (0,769 / skala z = −250)`);
  // zoom do maksimum kamery (3,2): sufit głębi trzyma niebo pod mid, choć skala z = −250 maleje (dawniej niebo / mid > 1
  // od zoomu ~2,1 przy 1080p)
  for (const scr of SCREENS) {
    for (let zoom = 0.1; zoom <= 3.2; zoom *= 1.25) {
      const s = skyLayerSpeeds(1137, zoom, SKY_SCROLL, 1, skyFocalPx(scr.h));
      assert.ok(s.sky < s.mid[0] * 0.8, `${scr.name} zoom ${zoom.toFixed(3)}: ${s.sky.toFixed(1)} vs ${s.mid[0].toFixed(1)}`);
    }
  }
  // dawne prawo (`?nieboTempo=stare`): dawne warstwy na kamerze gwiazd — kolejność też trzymana
  const deep = STAR_PARALLAX_LAYERS.find((l) => l.name === 'deep');
  const mid = STAR_PARALLAX_LAYERS.find((l) => l.name === 'mid');
  assert.ok(SKY_SCROLL_STARE.p >= deep.parallaxMax && SKY_SCROLL_STARE.p < mid.parallaxMin * 0.6);
  for (const m of SKY_MODES) {
    const s = skyLayerSpeeds(m.v, ZOOM_REF * m.k, SKY_SCROLL_STARE);
    assert.ok(s.sky < s.mid[0] && s.mid[1] < s.speed[0], `stare ${m.name}`);
  }
  // mnożnik > 1 przyspiesza mid razem z niebem (W0), < 1 — mid zostaje
  assert.equal(skyMidDriveMul(2), 2);
  assert.equal(skyMidDriveMul(0.5), 1);
});

test('sufit głębi: niebo wolniej niż planety tła (z = −50 000) przy każdym zoomie i kadrze; 16:9 w zoomie bojowym bez zmian', () => {
  // Planeta bez ringu na z = −50 000 płynie z paralaksą camZ / (camZ + 50 000), camZ = f / zoom (core3d.js: syncCamera).
  const src = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
  assert.match(src, new RegExp(`anchoredToRing \\? RING_PLANET_VISUAL_Z : -${SKY_SCROLL.bgDepth};`), 'głębokość planet tła = bgDepth');
  assert.match(src, new RegExp(`layerZ: -${SKY_SCROLL.starDepth},`), 'warstwy GameStars na z = −starDepth');
  const planet = (zoom, f) => { const camZ = f / zoom; return camZ / (camZ + SKY_SCROLL.bgDepth); };
  for (const scr of SCREENS) {
    const f = skyFocalPx(scr.h);
    for (let zoom = 0.02; zoom <= 3.2; zoom *= 1.2) {
      const pe = skyParallax(zoom, f);
      assert.ok(pe <= SKY_SCROLL.bgCap * planet(zoom, f) + 1e-12 && pe <= SKY_SCROLL.p, `${scr.name} zoom ${zoom.toFixed(3)}: ${pe}`);
      // dawne prawo i A/B bez sufitu — stałe p
      assert.equal(skyParallax(zoom, f, SKY_SCROLL_STARE), 0.03);
      assert.equal(skyParallax(zoom, f, SKY_SCROLL_BEZ_SUFITU), 0.1);
    }
  }
  // 16:9: zoom bojowy i kadr skoku bez sufitu (liczby tabeli bez zmian); 32:9 w walce — sufit (0,056), kątowo tyle co 16:9
  const [s1080, s1440, w1080, w1440] = SCREENS;
  assert.equal(s1080.h, 1080);
  assert.equal(skyParallax(ZOOM_REF, F1080), 0.1);
  assert.equal(skyParallax(zoomRef(s1440.w), F1440), 0.1);
  assert.equal(skyParallax(ZOOM_JUMP, F1080), 0.1);
  assert.ok(skyParallax(ZOOM_REF * 1.05, F1080) < 0.1, 'sufit od ×1,04 zoomu domyślnego przy 16:9');
  assert.ok(Math.abs(skyParallax(zoomRef(w1440.w), F1440) - 0.0557) < 1e-3);
  const deg = (v, scr, k) => skyScreenSpeed(v, zoomRef(scr.w) * k, SKY_SCROLL, 1, skyFocalPx(scr.h)) / skyFocalPx(scr.h) / DEG;
  assert.ok(deg(507, w1440, 1) / deg(507, s1440, 1) < 1.15, `32:9 / 16:9 w walce ×${(deg(507, w1440, 1) / deg(507, s1440, 1)).toFixed(2)}`);
  assert.ok(Math.abs(deg(507, w1080, 1) - deg(507, w1440, 1)) < 1e-9);
  // warp przy 32:9 — sufit prawie nie działa (0,0955): ~1,9× 16:9 kątowo
  assert.ok(deg(175000, w1440, 0.55) / deg(175000, s1080, 0.55) > 1.85);
  assert.ok(Math.abs(deg(175000, s1080, 0.55) - skyScreenSpeed(175000, ZOOM_JUMP) / F1080 / DEG) < 1e-12, '16:9 w skoku bez sufitu');
  // w walce na 32:9 nadal szybciej niż dawne prawo (×1,86)
  const nowe = skyScreenSpeed(1137, zoomRef(w1440.w), SKY_SCROLL, 1, F1440);
  const stare = skyScreenSpeed(1137, zoomRef(w1440.w), SKY_SCROLL_STARE, 1, F1440);
  assert.ok(nowe > 1.8 * stare, `${nowe} vs ${stare}`);
  // przybliżenie: tempo w px nie rośnie z zoomem (jak tarcza planety) — przy maksymalnym zoomie ~2 °/s przy dopalaczu
  // (~1 °/s z sufitu głębi × człon zwykłego lotu 2,10)
  const z1 = skyScreenSpeed(1137, 1, SKY_SCROLL, 1, F1080), z3 = skyScreenSpeed(1137, 3.2, SKY_SCROLL, 1, F1080);
  assert.ok(z3 / z1 < 1.1 && z3 / F1080 / DEG < 2.2, `${z1} → ${z3}`);
  // mnożnik A/B mnoży całe prawo (także sufit)
  assert.ok(Math.abs(skyParallax(zoomRef(w1440.w), F1440, SKY_SCROLL, 2) / skyParallax(zoomRef(w1440.w), F1440) - 2) < 1e-12);
  assert.equal(skyParallax(ZOOM_REF, F1080, SKY_SCROLL, 2), 0.2);
});

/**
 * Przebieg skoku (jak symulator warp-soczewka-sym.mjs S1 / S3, Mk II): walka, kop (smoothstep 0,9 s), lot z przelotem obok
 * planety (zwolnienie do 16%), rampa wyjścia (kadr przylotu), ślizg 16,2 tys. j/s, koniec rampy 16,2 → 2,7 tys. w 0,17 s,
 * SKOK prędkości 2,7 → 1,5 tys. w jednej klatce (koniec rampy w grze), dolot i powrót zoomu bojowego.
 */
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function warpProfile(t, exitZoom) {
  if (t < 1) return { v: 507, zoom: ZOOM_REF - (ZOOM_REF - ZOOM_JUMP) * sm(0.2, 1, t) };
  if (t < 1.9) return { v: 507 + (225000 - 507) * sm(1, 1.9, t), zoom: ZOOM_JUMP };
  if (t < 6) { const g = Math.exp(-(((t - 3.8) / 0.7) ** 2)); return { v: 225000 * (1 - 0.84 * g), zoom: ZOOM_JUMP }; }
  if (t < 6.7) { const u = sm(6, 6.7, t); return { v: 225000 + (16200 - 225000) * u, zoom: ZOOM_JUMP + (exitZoom - ZOOM_JUMP) * u }; }
  if (t < 7.2) return { v: 16200, zoom: exitZoom };
  if (t < 7.37) return { v: 16200 + (2700 - 16200) * (t - 7.2) / 0.17, zoom: exitZoom };
  if (t < 12) return { v: 1518 - (1518 - 507) * sm(7.37, 12, t), zoom: exitZoom + (ZOOM_REF - exitZoom) * sm(10, 12, t) };
  return { v: 507, zoom: ZOOM_REF };
}
function hyperProfile(t) {
  // rozruch, rozpęd 0 → 20 tys. w 5 s (fregata / Atlas), przelot, wyjście (hamowanie × 2) do 1000 j/s, regulator do 507
  if (t < 1) return { v: 507, zoom: ZOOM_REF - (ZOOM_REF - ZOOM_JUMP) * sm(0, 1, t) };
  if (t < 6) return { v: 507 + (20000 - 507) * (t - 1) / 5, zoom: ZOOM_JUMP };
  if (t < 9) return { v: 20000, zoom: ZOOM_JUMP };
  if (t < 11.5) return { v: 20000 - (20000 - 1000) * (t - 9) / 2.5, zoom: ZOOM_JUMP + (ZOOM_REF - ZOOM_JUMP) * sm(9, 11.5, t) };
  return { v: Math.max(507, 1000 - (t - 11.5) * 400), zoom: ZOOM_REF };
}

function runProfile(profile, hz, tune = SKY_SCROLL, mul = 1, T = 14) {
  const dt = 1 / hz;
  const s = createSkyScroll();
  const rows = [];
  let y = 0;
  for (let i = 0; i <= T * hz; i++) {
    const { v, zoom } = profile(i * dt);
    y -= v * dt;
    stepSkyScroll(s, 0, y, v, dt, zoom, F1080, 1, tune, mul);
    rows.push({ t: i * dt, v, zoom, sky: s.speedPx, drive: Math.sqrt(s.driveX * s.driveX + s.driveY * s.driveY) / dt });
  }
  return { s, rows };
}

test('W0 w przejściach: kop, przelot nad planetą, rampa wyjścia ze skokiem prędkości, hipercruise — klatka po klatce', () => {
  // mid na drodze nieba tej klatki (driveX / driveY — to samo, co dostaje StarSystem), speed — kamera z sufitem 14 tys.
  for (const hz of [60, 144, 240]) {
    for (const [name, profile] of [['skok, kadr przylotu 0,021', (t) => warpProfile(t, 0.021)], ['skok w punkt (zoom bojowy)', (t) => warpProfile(t, ZOOM_REF * 0.95)], ['hipercruise', hyperProfile]]) {
      for (const mul of [1, 1.5]) {
        const { rows } = runProfile(profile, hz, SKY_SCROLL, mul);
        const mm = skyMidDriveMul(mul);
        for (const r of rows.slice(2)) {
          if (!(r.drive > 0)) continue;
          const camZ = F1080 / r.zoom;
          const ks = camZ / (camZ + SKY_SCROLL.starDepth);   // skala ekranowa warstw GameStars na z = −250
          const midMin = r.drive * STAR_MID_SPHERE.parallaxMin * r.zoom * mm * ks;
          const midMax = r.drive * STAR_MID_SPHERE.parallaxMax * r.zoom * mm * ks;
          const speedMin = Math.min(r.v, SKY_SCROLL.starCap) * 1.02 * r.zoom * ks;
          assert.ok(r.sky * 1.2 < midMin, `${name} ${hz} Hz ×${mul} t ${r.t.toFixed(3)}: niebo ${r.sky.toFixed(1)} < mid ${midMin.toFixed(1)}`);
          assert.ok(midMax < speedMin * 0.9, `${name} ${hz} Hz ×${mul} t ${r.t.toFixed(3)}: mid ${midMax.toFixed(1)} < speed ${speedMin.toFixed(1)}`);
        }
      }
    }
  }
});

test('ciągłość: zwolnienie nad planetą i hamowanie wyjścia widać w tempie nieba — bez skoków, wygładzone z czasu klatek', () => {
  const { s, rows } = runProfile((t) => warpProfile(t, ZOOM_REF * 0.95), 240);
  const at = (t) => rows[Math.round(t * 240)];
  // przelot obok planety (prędkość × 0,16): niebo wyraźnie zwalnia i wraca (dawniej stało na suficie 14 tys.)
  assert.ok(at(3.8).sky < at(2.6).sky * 0.75 && at(5.6).sky > at(3.8).sky * 1.25, `${at(2.6).sky} → ${at(3.8).sky} → ${at(5.6).sky}`);
  const old = runProfile((t) => warpProfile(t, ZOOM_REF * 0.95), 240, SKY_SCROLL_STARE).rows;
  assert.ok(Math.abs(old[Math.round(3.8 * 240)].sky - old[Math.round(2.6 * 240)].sky) < 1e-9, 'dawne prawo: przelot niewidoczny');
  // poza skokiem prędkości na końcu rampy (straż W0 — świat zwalnia w tej klatce tak samo) tempo zmienia się w klatce
  // o ≤ 3% największego tempa przebiegu (wygładzenie 0,15 s przy 240 Hz: ≤ 2,7% różnicy do celu)
  const maxSky = Math.max(...rows.map((r) => r.sky));
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.t < 0.5) continue;   // start z postoju (droga nieba rośnie od zera)
    if (Math.abs(b.v - a.v) > 0.3 * Math.max(a.v, 1)) continue;   // skok wejścia gry (koniec rampy)
    assert.ok(Math.abs(b.sky - a.sky) <= maxSky * 0.03, `t ${b.t.toFixed(3)}: ${a.sky.toFixed(2)} → ${b.sky.toFixed(2)}`);
  }
  // koniec rampy 16,2 → 2,7 tys. j/s w 0,17 s: niebo hamuje dłużej niż świat (wygładzenie), dawne prawo — w tej samej klatce
  const tail = (r, t0) => { const ref = r[Math.round(t0 * 240)].sky; let i = Math.round(t0 * 240); while (r[i].sky > ref * 0.5) i++; return r[i].t - t0; };
  assert.ok(tail(rows, 7.2) > tail(old, 7.2) + 0.02, `nowe ${tail(rows, 7.2).toFixed(3)} s, dawne ${tail(old, 7.2).toFixed(3)} s`);
  assert.ok(s.vDrive > 0);
});

test('obrót w skoku: przebieg Mk II obraca niebo kilka razy mocniej niż dawniej (10 s lotu: ≥ 80°, dawniej ~17°)', () => {
  const nowe = runProfile((t) => warpProfile(t, 0.021), 60).s.turned / DEG;
  const dawne = runProfile((t) => warpProfile(t, 0.021), 60, SKY_SCROLL_STARE).s.turned / DEG;
  assert.ok(nowe > 4 * dawne, `${nowe.toFixed(1)}° vs ${dawne.toFixed(1)}°`);
  assert.ok(nowe > 30 && dawne < 15, `${nowe.toFixed(1)}° vs ${dawne.toFixed(1)}°`);
  // ?nieboTempo=2 — 2× (droga nieba ta sama, mnożnik tempa)
  const x2 = runProfile((t) => warpProfile(t, 0.021), 60, SKY_SCROLL, 2).s.turned / DEG;
  assert.ok(Math.abs(x2 / nowe - 2) < 0.05, `${x2} / ${nowe}`);
});

test('drobne gwiazdy: próg w px bufora na klatkę (6 → 12 px/kl.) — 144 i 240 Hz pełne wszędzie, 60 Hz gasi tylko warp na szerokim kadrze', () => {
  assert.equal(skyFineStarsGainPx(SKY_SCROLL.fadeFromPx), 1);
  assert.equal(skyFineStarsGainPx(SKY_SCROLL.fadeToPx), 0);
  assert.ok(Math.abs(skyFineStarsGainPx(9) - 0.5) < 1e-12);
  const gain = (v, scr, k, hz) => {
    const s = createSkyScroll();
    const dt = 1 / hz;
    const zoom = zoomRef(scr.w) * k;
    for (let i = 0; i <= 6 * hz; i++) { stepSkyScroll(s, v * i * dt, 0, v, dt, zoom, skyFocalPx(scr.h)); stepSkyFineGain(s, dt); }
    return s;
  };
  const [s1080, , , w1440] = SCREENS;
  // walka zawsze pełna — także przy maksymalnym zbliżeniu (sufit głębi: tempo w px nie rośnie z zoomem)
  for (const scr of SCREENS) for (const hz of [60, 144, 240]) {
    assert.equal(gain(1500, scr, 1, hz).fine, 1, `walka ${scr.name} ${hz} Hz`);
    assert.equal(gain(1137, scr, 3.2 / zoomRef(scr.w), hz).fine, 1, `walka zoom 3,2 ${scr.name} ${hz} Hz`);
  }
  // 144 i 240 Hz: pełne w każdym trybie i kadrze (także 4K 16:9 i sufit planu Mk III przy 32:9 1440p — 6,0 px/kl.)
  const K4 = { w: 3840, h: 2160 };
  for (const hz of [144, 240]) {
    for (const scr of [...SCREENS, K4]) {
      for (const v of [20000, 40000, 175000, 250000, 576923]) assert.equal(gain(v, scr, 0.55, hz).fine, 1, `${v} ${scr.w}×${scr.h} ${hz} Hz`);
    }
  }
  // 60 Hz: 16:9 1080p pełne nawet na suficie planu (5,6 px/kl.); 32:9 1440p — hipercruise pełny, warp Mk II zgaszony
  for (const v of [20000, 175000, 576923]) assert.equal(gain(v, s1080, 0.55, 60).fine, 1, `1080p 60 Hz ${v}`);
  assert.equal(gain(20000, w1440, 0.55, 60).fine, 1);
  const g60 = gain(175000, w1440, 0.55, 60);
  assert.ok(Math.abs(g60.pxFrame - 680.8 / 60) < 0.1, String(g60.pxFrame));
  assert.ok(g60.fine < 0.05, String(g60.fine));
  // 4K przy 60 Hz w warpie Mk II — częściowo (8,9 px/kl.)
  const g4k = gain(175000, K4, 0.55, 60);
  assert.ok(g4k.fine > 0.4 && g4k.fine < 0.65, String(g4k.fine));
  // dawne prawo: próg kątowy 2 → 4 °/s (≈ 60 → 120 px CSS/s przy 1080p)
  assert.ok(Math.abs(SKY_SCROLL_STARE.fadeFromDeg * DEG * F1080 - 60) < 0.5 && Math.abs(SKY_SCROLL_STARE.fadeToDeg * DEG * F1080 - 120) < 1);
  assert.equal(skyFineStarsGain(1.65 * DEG, SKY_SCROLL_STARE), 1);
  assert.equal(skyFineStarsGain(4.1 * DEG, SKY_SCROLL_STARE), 0);
});

test('drobne gwiazdy: udział i okres klatki wygładzone w czasie — zryw przygasza łagodnie, zacięcie nie gasi, pauza nie zmienia', () => {
  const s = createSkyScroll();
  const dt = 1 / 120;
  for (let i = 0; i < 240; i++) { s.speedPx = 0; stepSkyFineGain(s, dt); }   // okres klatki ustalony (120 Hz)
  assert.ok(Math.abs(s.framePeriod - dt) < 1e-4);
  // 0,4 s zrywu 9 px/kl. (połowa progu), potem spokój
  let minFine = 1;
  for (let i = 0; i < 48; i++) { s.speedPx = 9 * 120; minFine = Math.min(minFine, stepSkyFineGain(s, dt)); }
  assert.ok(minFine > 0.25 && minFine < 0.9, `min ${minFine.toFixed(3)}`);
  const before = s.fine;
  assert.equal(stepSkyFineGain(s, 0), before, 'pauza');
  for (let i = 0; i < 600; i++) { s.speedPx = 120; stepSkyFineGain(s, dt); }
  assert.equal(s.fine, 1, 'wraca do pełna (dosunięcie przy różnicy < 1e-3)');
  // zacięcie jednej klatki 200 ms przy 5 px/kl. — okres klatki obcięty (frameMax) i wygładzony: bez zgaszenia
  s.speedPx = 5 * 120;
  stepSkyFineGain(s, 0.2);
  assert.ok(s.fine > 0.95, String(s.fine));
});

test('smuga jasnych gwiazd: ruch nieba w ekspozycji 0,05 s (najwyżej 48 px CSS), najmniej dawna 0,22 · stretchPx (ładowanie skoku)', () => {
  const at = (v, scr, k, pxScale = 1, f = NaN) => skyStarStreakPx(skyScreenSpeed(v, zoomRef(scr.w) * k * pxScale, SKY_SCROLL, 1, f), pxScale);
  const [s1080, s1440, , w1440] = SCREENS;
  const base = 74 * 0.22;
  // 1080p: ruch w ekspozycji 13,4 / 7,0 px < dawna smuga — zostaje dawna (16,3 px)
  assert.ok(Math.abs(at(175000, s1080, 0.55) - base) < 1e-9, String(at(175000, s1080, 0.55)));
  assert.ok(Math.abs(at(20000, s1080, 0.55) - base) < 1e-9);
  assert.ok(Math.abs(at(175000, s1440, 0.55) - 17.8) < 0.1);
  assert.ok(Math.abs(at(175000, w1440, 0.55) - 35.6) < 0.1);
  assert.ok(Math.abs(at(175000, w1440, 0.55, 1, F1440) - 34.0) < 0.1, 'z sufitem głębi (32:9: p_ef 0,0955)');
  assert.equal(at(600000, w1440, 1), 48, 'sufit 48 px CSS');
  assert.equal(at(600000, w1440, 1, 2), 96, 'sufit × pxScale');
  // ładowanie skoku (statek stoi, WARP_STARS.stretch rośnie) i pauza — dawna smuga, nie 0 („zapowiedź” skoku)
  assert.ok(Math.abs(skyStarStreakPx(0, 1) - base) < 1e-9);
  assert.ok(Math.abs(skyStarStreakPx(49, 1, 74, SKY_SCROLL_STARE) - 16.28) < 1e-9);
});

test('parametr adresu ?nieboTempo / ?nieboSufit: stare / liczba / zły — ta sama funkcja na stronie i w workerze (RenderWorld.pageSearch)', () => {
  const T = (stare, mul, sufit = true) => ({ stare, mul, sufit });
  assert.deepEqual(skyTempoFrom(''), T(false, 1));
  assert.deepEqual(skyTempoFrom(undefined), T(false, 1));
  assert.deepEqual(skyTempoFrom('?nieboTempo=stare'), T(true, 1));
  assert.deepEqual(skyTempoFrom('?dev=1&nieboTempo=STARE&renderWorker=1'), T(true, 1));
  assert.deepEqual(skyTempoFrom('?nieboTempo=0.5'), T(false, 0.5));
  assert.deepEqual(skyTempoFrom('?niebo=sfera&nieboTempo=2'), T(false, 2));
  assert.deepEqual(skyTempoFrom('?nieboTempo=1,5'), T(false, 1.5));
  assert.deepEqual(skyTempoFrom('?nieboTempo=1000'), T(false, 10));
  assert.deepEqual(skyTempoFrom('?nieboTempo=0.001'), T(false, 0.05));
  for (const bad of ['?nieboTempo=abc', '?nieboTempo=-2', '?nieboTempo=0', '?nieboTempo=', '?niebotempo2=2', '?nieboTempo=%E0']) {
    assert.deepEqual(skyTempoFrom(bad), T(false, 1), bad);
  }
  assert.deepEqual(skyTempoFrom('?nieboSufit=0'), T(false, 1, false));
  assert.deepEqual(skyTempoFrom('?dev=1&nieboSufit=nie&nieboTempo=2'), T(false, 2, false));
  assert.deepEqual(skyTempoFrom('?nieboSufit=1'), T(false, 1));
  assert.deepEqual(skyTempoFrom('?nieboSufit=05'), T(false, 1));
  assert.equal(skyTempoTune(skyTempoFrom('?nieboTempo=stare')), SKY_SCROLL_STARE);
  assert.equal(skyTempoTune(skyTempoFrom('?nieboTempo=stare&nieboSufit=0')), SKY_SCROLL_STARE);
  assert.equal(skyTempoTune(skyTempoFrom('?nieboTempo=2')), SKY_SCROLL);
  assert.equal(skyTempoTune(skyTempoFrom('?nieboSufit=0')), SKY_SCROLL_BEZ_SUFITU);
  // dawne prawo dokładnie: tempo z sufitu 14 tys. · 0,03 · zoom, kąt z drogi tej klatki (bez wygładzenia)
  const s = createSkyScroll();
  const dt = 1 / 60;
  stepSkyScroll(s, 0, 0, 175000, dt, ZOOM_JUMP, F1080, 1, SKY_SCROLL_STARE);
  const a = stepSkyScroll(s, 175000 * dt, 0, 175000, dt, ZOOM_JUMP, F1080, 1, SKY_SCROLL_STARE);
  assert.ok(Math.abs(a - 14000 * dt * 0.03 * ZOOM_JUMP / F1080) < 1e-15, 'kąt z sufitu vCap');
  assert.ok(Math.abs(s.speedPx - 49.27) < 0.05);
});

test('znak obrotu: statek leci w górę ekranu (−y gry) → niebo pod kamerą płynie w dół ekranu (paralaksa)', () => {
  for (const tune of [SKY_SCROLL, SKY_SCROLL_STARE]) {
    const s = createSkyScroll();
    const dt = 1 / 60;
    stepSkyScroll(s, 0, 0, 500, dt, ZOOM_REF, F1080, 1, tune);
    const view = [0, 0, -1];
    const M0 = skyViewMatrix(s, 0, new Float64Array(9));
    const sky0 = mulV(M0, view);   // punkt nieba w środku kadru
    const t0 = s.turned;
    for (let i = 1; i <= 60; i++) stepSkyScroll(s, 0, -500 * i * dt, 500, dt, ZOOM_REF, F1080, 1, tune);
    // gdzie teraz na ekranie jest ten sam punkt nieba: widok = Mᵀ · niebo
    const v1 = mulTV(skyViewMatrix(s, 0, new Float64Array(9)), sky0);
    const px = [0, 0];
    skyEquidistantPx(v1, F1080, px);
    const expect = (s.turned - t0) * F1080;
    assert.ok(Math.abs(px[0]) < 1e-6, `bez ruchu w bok: ${px[0]}`);
    assert.ok(Math.abs(px[1] + expect) < 0.01, `w dół o ~${expect.toFixed(2)} px: ${px[1]}`);
    if (tune === SKY_SCROLL_STARE) assert.ok(Math.abs(expect - skyScreenSpeed(500, ZOOM_REF, tune)) < 0.01);
    else assert.ok(expect > skyScreenSpeed(500, ZOOM_REF) * 0.8 && expect < skyScreenSpeed(500, ZOOM_REF), String(expect));
    // lot w prawo (+x) → niebo w lewo
    const s2 = createSkyScroll();
    for (let i = 0; i <= 60; i++) stepSkyScroll(s2, 1000 * i * dt, 0, 1000, dt, ZOOM_REF, F1080, 1, tune);
    const v2 = mulTV(skyViewMatrix(s2, 0, new Float64Array(9)), mulV(skyViewMatrix(createSkyScroll(), 0, new Float64Array(9)), view));
    skyEquidistantPx(v2, F1080, px);
    assert.ok(px[0] < -6 && Math.abs(px[1]) < 1e-6, `w lewo: ${px}`);
  }
});

test('obrót kadru: kurs w górę ekranu — niebo płynie od dziobu ku rufie (w dół ekranu) przy każdym kursie', () => {
  for (const heading of [0, 0.7, 2.2, -1.9]) {
    const s = createSkyScroll();
    const dt = 1 / 60;
    // roll kursu w górę (viewRoll.js: ekran = R(−roll)·świat, y gry w dół): kurs na ekranie w górę ⇔ roll = heading + π/2
    const roll = heading + Math.PI / 2;
    const vx = Math.cos(heading) * 1000, vy = Math.sin(heading) * 1000;
    stepSkyScroll(s, 0, 0, 1000, dt, ZOOM_REF, F1080);
    const sky0 = mulV(skyViewMatrix(s, roll, new Float64Array(9)), [0, 0, -1]);
    for (let i = 1; i <= 30; i++) stepSkyScroll(s, vx * i * dt, vy * i * dt, 1000, dt, ZOOM_REF, F1080);
    const px = [0, 0];
    skyEquidistantPx(mulTV(skyViewMatrix(s, roll, new Float64Array(9)), sky0), F1080, px);
    assert.ok(Math.abs(px[0]) < 1e-6 && px[1] < -1, `kurs ${heading}: ${px}`);
  }
});

test('cięcie przy teleporcie: skok położenia nie obraca nieba — droga nieba biegnie wygładzoną prędkością; pauza stoi', () => {
  const dt = 1 / 60;
  // dawne prawo: w klatce cięcia bez obrotu
  const o = createSkyScroll();
  stepSkyScroll(o, 0, 0, 500, dt, ZOOM_REF, F1080, 1, SKY_SCROLL_STARE);
  stepSkyScroll(o, 500 * dt, 0, 500, dt, ZOOM_REF, F1080, 1, SKY_SCROLL_STARE);
  const q = Array.from(o.q);
  assert.equal(stepSkyScroll(o, 5e6, 0, 0, dt, ZOOM_REF, F1080, 1, SKY_SCROLL_STARE), 0);
  assert.equal(o.cuts, 1);
  assert.deepEqual(Array.from(o.q), q);
  // nowe prawo: kąt klatki cięcia = wygładzona prędkość, nie skok 5 mln j.
  const s = createSkyScroll();
  for (let i = 0; i <= 120; i++) stepSkyScroll(s, 500 * i * dt, 0, 500, dt, ZOOM_REF, F1080);
  const vd = s.vDrive;
  assert.ok(Math.abs(vd / skyDriveSpeed(500) - 1) < 1e-5, String(vd));
  const cut = stepSkyScroll(s, 5e6, 0, 500, dt, ZOOM_REF, F1080);   // teleport (DevScene.teleport, odrodzenie)
  assert.equal(s.cuts, 1);
  assert.ok(Math.abs(cut - vd * dt * SKY_SCROLL.p * ZOOM_REF / F1080) < 1e-12, 'trzyma prędkość, bez skoku');
  // pauza (dt = 0): bez obrotu, droga nieba bez zmian
  assert.equal(stepSkyScroll(s, 5e6 + 100, 0, 500, 0, ZOOM_REF, F1080), 0);
  assert.equal(s.vDrive, vd);
  // PAUZA W GRZE i worldFrozen: render(0, frame) z dt > 0, poza stoi, prędkość w stanie zostaje (warp Mk II, hipercruise,
  // walka): niebo i droga mid stoją razem ze światem, vN_wygł bez zmian — po wznowieniu bez rozpędu od zera
  for (const [v, zoom] of [[175000, ZOOM_JUMP], [20000, ZOOM_JUMP], [507, ZOOM_REF]]) {
    for (const hz of [60, 144, 240]) {
      const p = createSkyScroll();
      const h = 1 / hz;
      let x = 0;
      for (let i = 0; i <= 3 * hz; i++) { x += v * h; stepSkyScroll(p, x, 0, v, h, zoom, F1080); }
      const vd0 = p.vDrive;
      const t0 = p.turned;
      for (let i = 0; i < 2 * hz; i++) {
        assert.equal(stepSkyScroll(p, x, 0, v, h, zoom, F1080), 0, `pauza ${v} ${hz} Hz`);
        assert.ok(p.driveX === 0 && p.driveY === 0 && p.speedPx === 0, 'mid bez drogi nieba');
      }
      assert.equal(p.turned, t0);
      assert.equal(p.vDrive, vd0);
      // wznowienie: pełne tempo od pierwszej klatki
      x += v * h;
      stepSkyScroll(p, x, 0, v, h, zoom, F1080);
      assert.ok(Math.abs(p.vDrive - vd0) / vd0 < 1e-6, `${p.vDrive} vs ${vd0}`);
    }
  }
  // dawne prawo: postój — bez obrotu (droga tej klatki 0)
  const o2 = createSkyScroll();
  stepSkyScroll(o2, 0, 0, 900, dt, ZOOM_REF, F1080, 1, SKY_SCROLL_STARE);
  stepSkyScroll(o2, 15, 0, 900, dt, ZOOM_REF, F1080, 1, SKY_SCROLL_STARE);
  assert.equal(stepSkyScroll(o2, 15, 0, 900, dt, ZOOM_REF, F1080, 1, SKY_SCROLL_STARE), 0);
  assert.equal(o2.vDrive, 0);
  // nagłe hamowanie (wyjście z warpa przez hamowanie grawitacyjne): droga klatki ≤ 4 · prędkość poprzedniej — bez cięcia
  const s2 = createSkyScroll();
  stepSkyScroll(s2, 0, 0, 100000, dt, ZOOM_JUMP, F1080);
  stepSkyScroll(s2, 100000 * dt, 0, 0, dt, ZOOM_JUMP, F1080);
  assert.equal(s2.cuts, 0);
});

test('rzut równoodległy: przy obrocie nieba brzeg kadru 32:9 nie płynie szybciej niż środek (lustro CPU materiału)', () => {
  // obrót o mały kąt wokół osi ⟂ do kursu (kurs w górę ekranu): przesunięcie piksela na środku i na brzegach 32:9
  const f = F1440;
  const a = 1e-4;
  const shift = (px, py) => {
    const d = skyEquidistantDir(px, py, f, [0, 0, 0]);
    // obrót wokół osi x widoku o kąt a (niebo płynie w dół ekranu)
    const c = Math.cos(a), s = Math.sin(a);
    const r = [d[0], c * d[1] + s * d[2], -s * d[1] + c * d[2]];
    const p = [0, 0];
    skyEquidistantPx(r, f, p);
    return Math.hypot(p[0] - px, p[1] - py);
  };
  const center = shift(0, 0);
  assert.ok(Math.abs(center - a * f) / (a * f) < 1e-3, `środek ${center} ≈ a · f`);
  // w pionie (kierunek ruchu) brzeg = środek; w poziomie brzeg 32:9 (±64,2°) — nie szybciej niż środek
  for (const [x, y] of [[0, 719], [0, -719], [2559, 0], [-2559, 0], [2559, 719], [1200, -500]]) {
    const v = shift(x, y);
    assert.ok(v <= center * (1 + 1e-3), `(${x}, ${y}): ${v.toFixed(4)} vs środek ${center.toFixed(4)}`);
  }
  // dla porównania rzut gnomoniczny: brzeg 32:9 płynąłby ~(1 + tg²θ) razy szybciej (θ = atan(2560 / f_gnom))
  const th = Math.atan(2560 / f);
  assert.ok(1 + Math.tan(th) ** 2 > 2.2);
});

test('rzut równoodległy: piksel ↔ kierunek (lustro materiału), tempo brzegu = środka w kierunku promieniowym', () => {
  const f = F1440;
  const d = [0, 0, 0];
  const p = [0, 0];
  for (const [x, y] of [[0, 0], [1, 0], [-2559.5, 719.5], [2559.5, -719.5], [300, 200]]) {
    skyEquidistantDir(x, y, f, d);
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-12);
    skyEquidistantPx(d, f, p);
    assert.ok(Math.abs(p[0] - x) < 1e-6 && Math.abs(p[1] - y) < 1e-6, `${x},${y} → ${p}`);
  }
  // 32:9 (5120 × 1440): brzeg poziomy 2560 / f = 1,121 rad ≈ 64,2° od osi widoku
  skyEquidistantDir(2560, 0, f, d);
  assert.ok(Math.abs(Math.acos(-d[2]) - 2560 / f) < 1e-12);
  assert.ok(Math.abs(Math.acos(-d[2]) / DEG - 64.2) < 0.05);
});

test('orientacja startowa: środek kadru patrzy w (λ0, φ0), pas (∂λ) pod kątem bandDeg na ekranie', () => {
  const s = createSkyScroll();
  const M = skyViewMatrix(s, 0, new Float64Array(9));
  const c = mulV(M, [0, 0, -1]);
  const want = skyDirFromLonLat(SKY_START.lonDeg * DEG, SKY_START.latDeg * DEG, [0, 0, 0]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(c[i] - want[i]) < 1e-12);
  // kierunek pasa w osiach widoku
  const lon = SKY_START.lonDeg * DEG;
  const east = mulTV(M, [-Math.sin(lon), Math.cos(lon), 0]);
  const ang = Math.atan2(east[1], east[0]) / DEG;
  assert.ok(Math.abs(ang - SKY_START.bandDeg) < 1e-9, String(ang));
  // uv środka kadru
  const uv = skyEquirectUvCpu(c, [0, 0]);
  assert.ok(Math.abs(uv[0] - (SKY_START.lonDeg / 360 + 0.5)) < 1e-12 && Math.abs(uv[1] - (0.5 - SKY_START.latDeg / 180)) < 1e-12);
  // reset po obrocie wraca do startu
  stepSkyScroll(s, 0, 0, 500, 1 / 60, ZOOM_REF, F1080);
  stepSkyScroll(s, 500, 0, 500, 1, ZOOM_REF, F1080);
  resetSkyScroll(s);
  assert.deepEqual(Array.from(s.q), Array.from(skyStartQuat(new Float64Array(4))));
  assert.equal(s.track.has, false);
  assert.equal(s.fine, 1);
  assert.equal(s.vDrive, 0);
});

test('tropiciel drogi: cięcie per okręt, mieszanie dróg dwóch okrętów wagą (fregata zwiadu przy sterach)', () => {
  const dt = 1 / 60;
  const out = [0, 0];
  const tr = createSkyTrack();
  assert.equal(skyTrackStep(tr, 100, 200, 500, dt, out), 0, 'pierwsza klatka');
  assert.ok(Math.abs(skyTrackStep(tr, 108, 194, 600, dt, out) - 10) < 1e-12);
  assert.deepEqual(out, [8, -6]);
  assert.equal(skyTrackStep(tr, 9e6, 0, 600, dt, out), 0, 'teleport');
  assert.equal(tr.cuts, 1);
  assert.deepEqual(out, [0, 0]);
  assert.equal(skyTrackStep(tr, NaN, 0, 0, dt, out), 0);
  assert.equal(tr.has, false, 'poza niepoliczalna — zapomniane miejsce');
  // waga 1: niebo jedzie z drogi fregaty, Atlas stoi; waga 0,5 — połowa każdej drogi (dawne prawo — kąt z drogi klatki)
  for (const tune of [SKY_SCROLL_STARE, SKY_SCROLL]) {
    const fr = createSkyTrack(), at = createSkyTrack();
    const sA = createSkyScroll(), sB = createSkyScroll();
    const a = [0, 0], b = [0, 0];
    const n = tune === SKY_SCROLL ? 240 : 60;
    for (let i = 0; i <= n; i++) {
      skyTrackStep(at, 0, 0, 0, dt, a);                        // Atlas stoi
      skyTrackStep(fr, 900 * i * dt, 3e4, 900, dt, b);        // fregata 900 j/s w prawo, 30 tys. j. od Atlasa
      skyScrollMove(sA, a[0] * 0 + b[0] * 1, a[1] * 0 + b[1] * 1, dt, ZOOM_REF, F1080, 1, tune, 1, false, 900);
      skyScrollMove(sB, a[0] * 0.5 + b[0] * 0.5, a[1] * 0.5 + b[1] * 0.5, dt, ZOOM_REF, F1080, 1, tune, 1, false, 450);
    }
    // rad/s — droga nieba z prędkości zmieszanej drogi (nowe prawo: człon zwykłego lotu nie jest liniowy w v)
    const want = skyDriveSpeed(900, tune) * tune.p * ZOOM_REF / F1080;
    const wantB = skyDriveSpeed(450, tune) * tune.p * ZOOM_REF / F1080;
    if (tune === SKY_SCROLL_STARE) {
      assert.ok(Math.abs(sA.turned - want) / want < 1e-9, `${sA.turned} vs ${want}`);
      assert.ok(Math.abs(sB.turned - want / 2) / want < 1e-9);
    }
    assert.ok(Math.abs(sA.omega - want) / want < 1e-6, `${tune === SKY_SCROLL ? 'nowe' : 'dawne'}: ${sA.omega} vs ${want}`);
    assert.ok(Math.abs(sB.omega - wantB) / want < 1e-6);
  }
});

test('macierze: widok → niebo ortonormalna, świat → niebo = transpozycja q, kąt między macierzami', () => {
  const s = createSkyScroll();
  for (let i = 0; i < 400; i++) stepSkyScroll(s, Math.cos(i * 0.05) * 30000, Math.sin(i * 0.03) * 20000, 3000, 1 / 60, 0.3, F1080);
  const M = skyViewMatrix(s, 0.4, new Float64Array(9));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += M[i * 3 + k] * M[j * 3 + k];
      assert.ok(Math.abs(dot - (i === j ? 1 : 0)) < 1e-9);
    }
  }
  const W = skyWorldMatrix(s, new Float64Array(9));
  const Q = quatToMat3(s.q, new Float64Array(9));
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(W[i * 3 + k] - Q[k * 3 + i]) < 1e-15);
  // roll 0: widok = świat
  const M0 = skyViewMatrix(s, 0, new Float64Array(9));
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(M0[i] - W[i]) < 1e-15);
  // kąt: mały obrót mierzony bez utraty precyzji (kąt kroku = turned)
  const s2 = createSkyScroll();
  const A = skyViewMatrix(s2, 0, new Float64Array(9));
  stepSkyScroll(s2, 0, 0, 500, 1 / 240, ZOOM_REF, F1080);
  stepSkyScroll(s2, 500 / 240, 0, 500, 1 / 240, ZOOM_REF, F1080);
  const B = skyViewMatrix(s2, 0, new Float64Array(9));
  assert.ok(s2.turned > 0);
  assert.ok(Math.abs(mat3AngleBetween(A, B) - s2.turned) / s2.turned < 1e-6, `${mat3AngleBetween(A, B)} vs ${s2.turned}`);
});

test('holonomia: krążenie w bitwie obraca niebo wokół osi widoku powoli — w ruchu niewidoczne', () => {
  // krąg r 20 tys. przy 507 j/s (4 min): niebo „toczy się” po drodze (kąt drogi = 2πr · vN / v · p · zoom / f ≈ 210°
  // z członem zwykłego lotu, bez niego ~90°) i wraca obrócone wokół osi widoku o ~56° (bez członu ~11°, dawniej ~1°) —
  // 0,22 °/s przy przepływie nieba 0,84 °/s: obrót wokół środka kadru ginie w ruchu przy krążeniu
  const s = createSkyScroll();
  const M0 = skyViewMatrix(s, 0, new Float64Array(9));
  const r = 20000, v = 507, dt = 1 / 60;
  const T = 2 * Math.PI * r / v;
  const n = Math.round(T / dt);
  for (let i = 0; i <= n; i++) {
    const a = 2 * Math.PI * i / n;
    stepSkyScroll(s, r * Math.cos(a), r * Math.sin(a), v, dt, ZOOM_REF, F1080);
  }
  const M1 = skyViewMatrix(s, 0, new Float64Array(9));
  const deg = mat3AngleBetween(M0, M1) / DEG;
  assert.ok(deg < 60, `krąg r 20 tys.: ${deg.toFixed(2)}°`);
  assert.ok(deg / T < 0.25, `${(deg / T).toFixed(3)} °/s`);
});

test('bez alokacji w kroku: stan w Float64Array, krok i macierze piszą w miejscu', () => {
  const s = createSkyScroll();
  const out = new Float64Array(9);
  const q = s.q;
  stepSkyScroll(s, 0, 0, 500, 1 / 60, 0.3, F1080);
  stepSkyScroll(s, 10, 3, 500, 1 / 60, 0.3, F1080);
  stepSkyFineGain(s, 1 / 60);
  assert.equal(s.q, q);
  assert.equal(skyViewMatrix(s, 0.2, out), out);
});
