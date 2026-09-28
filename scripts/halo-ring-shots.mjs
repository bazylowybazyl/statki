// Automatyczne zrzuty dema ringu Halo (brief §13–§14): Vite + headless Chrome
// przez CDP (bez zależności — WebSocket z Node 22). Dla każdego ujęcia:
// zrzut PNG, draw calle, trójkąty, ms/klatkę, histogram HDR, błędy shaderów.
// Port WebGPU (zadanie 06): demo na WebGPURenderer — nazwa GPU z adaptera
// (window.__halo.gpu), błędy walidacji WebGPU z domeny Log, czas budowy ringu
// (kompilacja + pieczenie + odczyt) i liczba zamienników materiałów (07–10).
//
// Zadanie 07: --teren — tylko teren ringu (struktura, dach, chmury, powłoka powietrza,
// megastruktura, miasto i hale K-7 ukryte; otoczenie dema zostaje) — porównanie
// terenu z bazą WebGL z tagu, póki reszta ringu to zamienniki (08–10). Ten sam
// skrypt działa w worktree z tagu webgl-baseline (demo na WebGLRenderer).
// Zadanie 08: --czesci terrain,structure,structureTop,clouds,shell[,mega,city,k7] — tylko
// wymienione części ringu (reszta ukryta jak w --teren; --teren = --czesci terrain);
// wynik i czasy kompilacji materiałów (window.__halo.compileMs) w results.json.
//
//   node scripts/halo-ring-shots.mjs --set m2 --out .tmp/halo-ring/m2
//   node scripts/halo-ring-shots.mjs --only p1,p8 --size 2560x1440
//   node scripts/halo-ring-shots.mjs --set m4 --teren --out .tmp/halo-ring/m4-teren
//   node scripts/halo-ring-shots.mjs --set mid --czesci terrain,structure,structureTop,clouds,shell --out .tmp/halo-ring/mid-08
//   node scripts/halo-ring-shots.mjs --repo ../statki-wt/tag13 --set miasto --port 5360 --out .tmp/halo-ring/miasto-tag
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { closeChrome } from '../dema/rdzen-cdp.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
// --repo <katalog>: serwuj demo z innego drzewa (np. worktree z tagu webgl-baseline — baza WebGL
// bez kopiowania skryptu; zadanie 09). Wyniki (--out) względem bieżącego repo.
const here = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = args.repo ? resolve(args.repo) : here;
const outDir = resolve(here, args.out || '.tmp/halo-ring');
mkdirSync(outDir, { recursive: true });
const [W, H] = (args.size || '1920x1080').split('x').map(Number);
const quality = args.quality || 'high';
const benchSize = (args.bench || '2560x1440').split('x').map(Number);

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find((p) => existsSync(p));

// Ujęcia: kamera gry na 4 zoomach (M1) + presety (M2) + wariant W = 3000.
const a45 = Math.PI / 4;
const at = (r) => ({ x: Math.cos(a45) * r, y: Math.sin(a45) * r });
const atA = (r, deg) => ({ x: Math.cos(deg * Math.PI / 180) * r, y: Math.sin(deg * Math.PI / 180) * r });
const SHOTS = [
  { id: 'game_z0035', q: { cam: 'game', preset: 7, zoom: 0.035, ...at(30500) } },
  { id: 'game_z02', q: { cam: 'game', preset: 7, zoom: 0.2, ...at(39000) } },
  { id: 'game_z1', q: { cam: 'game', preset: 7, zoom: 1.0, ...at(42300) } },
  { id: 'game_z32', q: { cam: 'game', preset: 7, zoom: 3.2, ships: 0, ...at(42600) } },
  { id: 'p1', q: { preset: 1 } },
  { id: 'p2', q: { preset: 2 } },
  { id: 'p3', q: { preset: 3 } },
  { id: 'p4', q: { preset: 4 } },
  { id: 'p5', q: { preset: 5 } },
  { id: 'p6', q: { preset: 6 } },
  { id: 'p7', q: { preset: 7 } },
  { id: 'p8', q: { preset: 8 } },
  // §6: słońce po stronie odcinka — habitat patrzy na dzienną stronę planety i sam jest w nocy
  { id: 'p7_sunside', q: { preset: 7, az: -10, el: 49 } },
  { id: 'w3000_p8', q: { preset: 8, w: 3000 } },
  { id: 'w3000_p1', q: { preset: 1, w: 3000 } },
  { id: 'w3000_game_z0035', q: { cam: 'game', preset: 7, zoom: 0.035, w: 3000, ...at(30500) } },
  { id: 'tilt10_game_z02', q: { cam: 'game', preset: 7, zoom: 0.2, tilt: 10, ...at(39000) } },
  { id: 'tilt10_game_z0035', q: { cam: 'game', preset: 7, zoom: 0.035, tilt: 10, ...at(30500) } },
  // zaćmienie (§6): ten sam kadr co p6, słońce 40° — kamera w cieniu planety, łuk w dniu
  { id: 'p6_eclipse', q: { preset: 6, az: -159.5, el: 40 } },
  { id: 'ui_p1', ui: true, q: { preset: 1 } },
  // Habitat w stronę kosmosu (domyślny od 2026-09-23): kamera gry POZA ringiem
  { id: 'out_game_z1', q: { cam: 'game', preset: 7, zoom: 1.0, ships: 0, ...at(43752 + 1000) } },
  { id: 'out_game_z02', q: { cam: 'game', preset: 7, zoom: 0.2, ...at(43752 + 4000) } },
  { id: 'out_game_z0035', q: { cam: 'game', preset: 7, zoom: 0.035, ...at(52000) } },
  // te same kadry w wariancie Halo (habitat do planety) — do porównania
  { id: 'in_game_z1', q: { facing: 'in', cam: 'game', preset: 7, zoom: 1.0, ships: 0, az: -25, ...at(43752 + 1000) } },
  { id: 'in_game_z02', q: { facing: 'in', cam: 'game', preset: 7, zoom: 0.2, az: -25, ...at(43752 + 4000) } },
  { id: 'in_p1', q: { facing: 'in', preset: 1 } },
  { id: 'in_p8', q: { facing: 'in', preset: 8 } },
  // M3: megastruktura i port (kamera gry przy stacji Ziemi = port, i nad dachem obok)
  { id: 'm3_port_z0035', q: { cam: 'game', preset: 7, zoom: 0.035, ...at(52000) } },
  { id: 'm3_port_z02', q: { cam: 'game', preset: 7, zoom: 0.2, ships: 0, ...at(45200) } },
  { id: 'm3_port_z1', q: { cam: 'game', preset: 7, zoom: 1.0, ...at(44600) } },
  { id: 'm3_port_z32', q: { cam: 'game', preset: 7, zoom: 3.2, ships: 0, ...at(43900) } },
  { id: 'm3_roof_z02', q: { cam: 'game', preset: 7, zoom: 0.2, ships: 0, ...atA(43000, 62) } },
  { id: 'm3_roof_z1', q: { cam: 'game', preset: 7, zoom: 1.0, ships: 0, ...atA(42800, 62) } },
  { id: 'm3_port_night_z02', q: { cam: 'game', preset: 7, zoom: 0.2, ships: 0, az: 135, el: 20, ...at(45200) } },
  { id: 'p9', q: { preset: 9 } },
  // M4: miasto na podłodze i na ścianie z kamery gry. Sektory: MERIDIAN (ogród)
  // 67,5°, EDEN (szkło) 45° w układzie sceny; w układzie gry (y w dół) kąt z minusem.
  { id: 'm4_city_z1', q: { cam: 'game', preset: 7, zoom: 1.0, ships: 0, az: 47.5, el: 49, ...atA(43752 + 900, -67.5) } },
  { id: 'm4_city_night_z1', q: { cam: 'game', preset: 7, zoom: 1.0, ships: 0, az: -112.5, el: 15, ...atA(43752 + 900, -67.5) } },
  { id: 'm4_glass_z02', q: { cam: 'game', preset: 7, zoom: 0.2, ships: 0, az: 25, el: 49, ...atA(43752 + 2500, -45) } },
  // K-7 w trybie lotu (Atlas gracza, kamera gry za statkiem)
  { id: 'k7_docked_z1', q: { cam: 'flight', k7: 'docked', zoom: 1.0 } },
  { id: 'k7_docked_z035', q: { cam: 'flight', k7: 'docked', zoom: 0.35 } },
  { id: 'k7_free_gate_z05', q: { cam: 'flight', k7: 'free', zoom: 0.5 } },
  { id: 'k7_hall_z016', q: { cam: 'flight', k7: 'docked', zoom: 0.16 } },
  // miasto z kamery gry z zewnątrz ringu (jak na zrzutach użytkownika)
  { id: 'city_garden_z034', q: { cam: 'game', preset: 7, zoom: 0.342, ships: 0, az: 47.5, el: 49, ...atA(43752 + 1800, -67.5) } },
  { id: 'city_heph_z034', q: { cam: 'game', preset: 7, zoom: 0.342, ships: 0, az: 92.5, el: 49, ...atA(43752 + 1800, -112.5) } },
  { id: 'city_heph_z089', q: { cam: 'game', preset: 7, zoom: 0.894, ships: 0, az: 92.5, el: 49, ...atA(43752 + 700, -112.5) } },
  { id: 'ui_k7', ui: true, q: { cam: 'flight', k7: 'docked', zoom: 0.55 } },
  // Płaszczyzna gry na środku wstęgi (2026-09-23): K-7 i doki wpięte w podłogę
  { id: 'mid_k7_z016', q: { cam: 'flight', k7: 'docked', zoom: 0.16 } },
  { id: 'mid_k7_z01', q: { cam: 'flight', k7: 'docked', zoom: 0.1 } },
  { id: 'mid_port_side_z02', q: { cam: 'game', preset: 7, zoom: 0.2, ...atA(48000, 38) } },
  { id: 'mid_port_side_z034', q: { cam: 'game', preset: 7, zoom: 0.342, ...atA(46500, 36) } },
  { id: 'mid_port_z01', q: { cam: 'game', preset: 7, zoom: 0.1, ...atA(50000, 42) } },
  { id: 'mid_roof_z1', q: { cam: 'game', preset: 7, zoom: 1.0, ships: 0, ...atA(43752 + 900, 62) } },
  { id: 'mid_roof_z03', q: { cam: 'game', preset: 7, zoom: 0.3, ships: 0, ...atA(43752 + 3000, 62) } },
  { id: 'mid_plane_roof_p9', q: { preset: 9, plane: 'roof' } },
  // strefy wokół doków (pas fabryczny → domy) i tranzyty przez ring (2026-09-23)
  { id: 'transit_t01', q: { preset: 10 } },
  { id: 'transit_flight_z035', q: { cam: 'flight', k7: 'transit', zoom: 0.35 } },
  { id: 'transit_flight_z015', q: { cam: 'flight', k7: 'transit', zoom: 0.15 } },
  { id: 'transit_game_z005', q: { cam: 'game', preset: 7, zoom: 0.05, ...atA(47000, 270) } },
  // otwarte zatoki ze stanowiskami K-7 i kadłuby gracza jak NPC (2026-09-23)
  { id: 'bay_cont_z035', q: { cam: 'flight', k7: 'docked', hull: 'container_ship', zoom: 0.35 } },
  { id: 'bay_cont_z1', q: { cam: 'flight', k7: 'docked', hull: 'container_ship', zoom: 1.0 } },
  { id: 'bay_mega_z02', q: { cam: 'flight', k7: 'docked', hull: 'megafreighter', zoom: 0.2 } },
  { id: 'bay_long_z06', q: { cam: 'flight', k7: 'docked', hull: 'long_haul_freighter', zoom: 0.6 } },
  { id: 'bay_shuttle_z2', q: { cam: 'flight', k7: 'docked', hull: 'inter_station_shuttle', zoom: 2.0 } },
  { id: 'bay_free_z03', q: { cam: 'flight', k7: 'free', hull: 'container_ship', zoom: 0.3 } },
  // megabudowle z ECUMENE (2026-09-24): ujęcie od frontu, noc, kamera gry
  { id: 'lm0_gate', q: { landmark: 0 } },
  { id: 'lm1_terrace', q: { landmark: 1 } },
  { id: 'lm2_crown', q: { landmark: 2 } },
  { id: 'lm4_bridge', q: { landmark: 4 } },
  { id: 'lm6_glass_gate', q: { landmark: 6 } },
  { id: 'lm2_night', q: { landmark: 2, night: 1 } },
  { id: 'lm0_game_z045', q: { landmark: 0, cam: 'game', zoom: 0.45 } },
  { id: 'lm2_game_z02', q: { landmark: 2, cam: 'game', zoom: 0.2 } },
  { id: 'lm1_game_z1', q: { landmark: 1, cam: 'game', zoom: 1.0 } },
  { id: 'lm5_game_night_z045', q: { landmark: 5, cam: 'game', zoom: 0.45, night: 1 } },
  // kopuły-biosfery i parki (2026-09-25): tropiki, akwarium, dzicz, ogród, noc, kamera gry
  { id: 'dome0_tropical', q: { dome: 0 } },
  { id: 'dome5_aquatic', q: { dome: 5 } },
  { id: 'dome9_wild', q: { dome: 9 } },
  { id: 'dome3_botanical', q: { dome: 3 } },
  { id: 'dome0_night', q: { dome: 0, night: 1 } },
  { id: 'dome0_game_z045', q: { dome: 0, cam: 'game', zoom: 0.45 } },
  { id: 'dome2_game_z1', q: { dome: 2, cam: 'game', zoom: 1.0 } },
  { id: 'lm3_park_night', q: { landmark: 3, night: 1 } }
];
// zestawy: --set flip (obrót habitatu), domyślnie wszystko
const SETS = {
  flip: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'out_game_z1', 'out_game_z02', 'out_game_z0035', 'in_game_z1', 'in_game_z02', 'in_p1', 'in_p8'],
  m3: ['m3_port_z0035', 'm3_port_z02', 'm3_port_z1', 'm3_port_z32', 'm3_roof_z02', 'm3_roof_z1', 'm3_port_night_z02', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'],
  m4: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'm3_port_z02', 'm3_port_z1', 'm4_city_z1', 'm4_city_night_z1', 'm4_glass_z02'],
  m5: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'm3_port_z0035', 'm3_port_z02', 'm3_port_z1', 'm3_port_z32',
    'm3_roof_z02', 'm3_port_night_z02', 'm4_city_z1', 'm4_city_night_z1', 'm4_glass_z02'],
  // poprawki po uwagach: K-7 (lot i dokowanie), LOD miasta, przemysł
  k7: ['k7_docked_z1', 'k7_docked_z035', 'k7_free_gate_z05', 'k7_hall_z016', 'p9', 'm3_port_z0035', 'm3_port_z02',
    'city_garden_z034', 'city_heph_z034', 'city_heph_z089', 'm4_city_z1', 'm4_city_night_z1', 'p5', 'p6', 'p7'],
  // doki na środku wstęgi (płaszczyzna gry przecina ring w połowie)
  mid: ['p9', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'k7_docked_z1', 'k7_docked_z035', 'mid_k7_z016', 'mid_k7_z01',
    'k7_free_gate_z05', 'mid_port_side_z02', 'mid_port_side_z034', 'mid_port_z01', 'm3_port_z0035',
    'city_garden_z034', 'city_heph_z034', 'city_heph_z089', 'mid_roof_z1', 'mid_roof_z03', 'ui_k7'],
  bays: ['p9', 'p2', 'p6', 'p8', 'k7_docked_z1', 'k7_docked_z035', 'mid_k7_z016', 'mid_k7_z01', 'bay_cont_z035', 'bay_cont_z1',
    'bay_mega_z02', 'bay_long_z06', 'bay_shuttle_z2', 'bay_free_z03', 'transit_flight_z035', 'mid_port_side_z02', 'mid_port_z01'],
  zones: ['p9', 'transit_t01', 'transit_flight_z035', 'transit_flight_z015', 'transit_game_z005', 'p2', 'p3', 'p5', 'p6', 'p8',
    'k7_docked_z1', 'k7_docked_z035', 'mid_k7_z016', 'mid_k7_z01', 'mid_port_side_z02', 'mid_port_z01', 'm3_port_z0035',
    'city_garden_z034', 'city_heph_z034', 'city_heph_z089'],
  landmarks: ['lm0_gate', 'lm1_terrace', 'lm2_crown', 'lm4_bridge', 'lm6_glass_gate', 'lm2_night', 'lm0_game_z045', 'lm2_game_z02',
    'lm1_game_z1', 'lm5_game_night_z045', 'p6', 'p9', 'm4_city_z1', 'k7_docked_z035'],
  domes: ['dome0_tropical', 'dome5_aquatic', 'dome9_wild', 'dome3_botanical', 'dome0_night', 'dome0_game_z045', 'dome2_game_z1',
    'lm0_gate', 'lm3_park_night', 'lm0_game_z045', 'p6', 'm4_city_z1'],
  // zadanie 09 (megastruktura i miasto w TSL): miasto dniem i nocą, przemysł, dach z detalem, pociągi i światłami
  miasto: ['m4_city_z1', 'm4_city_night_z1', 'm4_glass_z02', 'city_garden_z034', 'city_heph_z034', 'city_heph_z089',
    'm3_port_night_z02', 'm3_roof_z02', 'm3_roof_z1', 'mid_roof_z1', 'mid_roof_z03', 'p5', 'p7', 'p9']
};

// Profile planet (Z6, 2026-09-26): --planet mars|jupiter|earth — ring z profilem
// planety, promień i ziarno jak w grze; ujęcia liczone z promieni tego ringu
// (sektor k: kąt gry 45° − 22,5°·k, słońce 20° przed nim). Zestaw „profile”.
const planet = args.planet || '';
let planetSeed = '1337';
if (planet) {
  const { createHaloRingLayout } = await import('../src/3d/haloRing/haloRingLayout.js');
  const { RING_PLANET_WORLD_RADII } = await import('../src/3d/ringScale.js');
  const { HALO_RING_PLANETS } = await import('../src/game/haloRingPlanets.js');
  const spec = HALO_RING_PLANETS[planet];
  planetSeed = String(spec.seed);
  const L = createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII[planet], seed: spec.seed, profile: spec.profile });
  const rim = L.radii.rim;
  const secPhi = (k) => 45 - 22.5 * k;
  const secSun = (k) => ({ az: -secPhi(k) - 20, el: 49 });
  const P = (id, q) => ({ id: `${planet}_${id}`, q });
  const sectorViews = (k, zoom = 0.342, off = 1800) => P(`sec${k}_z${String(zoom).replace('.', '')}`, { cam: 'game', preset: 7, zoom, ships: 0, ...secSun(k), ...atA(rim + off, secPhi(k)) });
  const profileShots = [
    P('p8', { preset: 8 }), P('p9', { preset: 9 }), P('p1', { preset: 1 }), P('p2', { preset: 2 }), P('p3', { preset: 3 }),
    P('p4', { preset: 4 }), P('p5', { preset: 5 }), P('p6', { preset: 6 }), P('transit', { preset: 10 }),
    P('game_port_z0035', { cam: 'game', preset: 7, zoom: 0.035, ...atA(rim + 8250, 45) }),
    P('game_port_z01', { cam: 'game', preset: 7, zoom: 0.1, ...atA(rim + 6250, 42) }),
    P('game_port_z02', { cam: 'game', preset: 7, zoom: 0.2, ...atA(rim + 4250, 38) }),
    P('game_port_night_z02', { cam: 'game', preset: 7, zoom: 0.2, ships: 0, az: 135, el: 20, ...atA(rim + 4250, 38) }),
    P('k7_docked_z035', { cam: 'flight', k7: 'docked', zoom: 0.35 }),
    P('k7_hall_z016', { cam: 'flight', k7: 'docked', zoom: 0.16 }),
    P('k7_docked_z1', { cam: 'flight', k7: 'docked', zoom: 1.0 }),
    P('bay_cont_z035', { cam: 'flight', k7: 'docked', hull: 'container_ship', zoom: 0.35 }),
    P('lm0', { landmark: 0 }), P('lm1', { landmark: 1 }), P('lm0_game_z045', { landmark: 0, cam: 'game', zoom: 0.45 }),
    P('dome0', { dome: 0 }), P('dome0_game_z045', { dome: 0, cam: 'game', zoom: 0.45 }), P('dome0_night', { dome: 0, night: 1 }),
    ...[1, 2, 3, 5, 7, 9, 11, 13, 15].map((k) => sectorViews(k)),
    sectorViews(1, 0.1, 5000), sectorViews(7, 0.1, 5000)
  ];
  SHOTS.push(...profileShots);
  SETS.profile = profileShots.map((s) => s.id);
}

const only = args.only ? new Set(args.only.split(',')) : (args.set && SETS[args.set] ? new Set(SETS[args.set]) : null);
const shots = SHOTS.filter((s) => !only || only.has(s.id));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: ok, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else ok(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, reject) => this.pending.set(id, { resolve: ok, reject }));
  }
  on(fn) { this.handlers.push(fn); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(cdp, expression, timeout = 120000) {
  const res = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
  return res.result.value;
}

// Profil headless Chrome w %TEMP% (75–300 MB: pamięć podręczna shaderów) — usuwany na końcu i przy
// błędzie wspólnym closeChrome (dema/rdzen-cdp.js: czeka na wyjście Chrome, potem kasuje profil;
// dawniej zostawał po każdym uruchomieniu — 2026-09-28 dysk się zapełnił). removeChromeProfile to
// już tylko synchroniczna siatka na nagłe wyjście procesu (process.on('exit') nie czeka na await).
let chromeProfile = null;
let chromeProc = null;
function removeChromeProfile() {
  if (chromeProc && chromeProc.exitCode === null) { try { chromeProc.kill(); } catch { /* */ } }
  if (!chromeProfile) return;
  try { rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); } catch { /* zablokowany */ }
  chromeProfile = null;
}
process.on('exit', removeChromeProfile);

async function main() {
  const server = await createServer({
    root: repo, logLevel: 'error',
    server: { port: Number(args.port) || 5230, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } },
    // bez tego pierwsze wykrycie three/webgpu i three/tsl przeładowuje stronę
    optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl'] }
  });
  await server.listen();
  const port = server.config.server.port;
  const base = `http://localhost:${server.httpServer.address().port}`;
  void port;
  const profile = join(tmpdir(), `halo-shots-${Date.now()}`);
  chromeProfile = profile;
  const dbgPort = 9333 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-unsafe-webgpu',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--hide-scrollbars',
    `--window-size=${W},${H}`, 'about:blank'
  ], { stdio: 'ignore' });
  chromeProc = chrome;
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch { /* czekam na Chrome */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Chrome nie wystartował');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  const cdp = new Cdp(ws);
  const logs = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      // zamiennik gry ostrzega raz na nieprzeniesiony materiał — liczy je `zamienniki`, to nie błąd
      if (!text.startsWith('[Zamiennik]')) logs.push(`[${msg.params.type}] ${text}`.slice(0, 2000));
    }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
    // walidacja WebGPU / WGSL przychodzi przez domenę Log, nie przez console
    if (msg.method === 'Log.entryAdded' && (msg.params.entry.level === 'error' || msg.params.entry.level === 'warning')) {
      const e = msg.params.entry;
      if (!/favicon|powerPreference/.test(`${e.text} ${e.url || ''}`)) logs.push(`[log:${e.level}] ${e.source}: ${e.text}${e.url ? ` (${e.url})` : ''}`.slice(0, 2000));
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  const results = [];
  for (const shot of shots) {
    logs.length = 0;
    const q = new URLSearchParams({ ...(shot.ui ? {} : { shot: '1' }), quality, seed: planetSeed, ...(planet ? { planet } : {}), ...Object.fromEntries(Object.entries(shot.q).map(([k, v]) => [k, String(v)])) });
    const url = `${base}/dema/halo_ring_demo.html?${q}`;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    const t0 = Date.now();
    // stara strona nie może odpowiedzieć „gotowe” za nową (wolne ładowanie)
    try { await evaluate(cdp, 'window.__halo = undefined, true'); } catch { /* pierwsza strona */ }
    await cdp.send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 600 && !ready; i++) {
      await sleep(200);
      const expr = shot.ui ? '!!(window.__halo && window.__halo.ring.mapsReady)' : '!!(window.__halo && window.__halo.ready)';
      try { ready = await evaluate(cdp, expr); } catch { ready = false; }
    }
    if (ready && shot.ui) {
      await sleep(2500);
      const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(outDir, `${shot.id}.png`), Buffer.from(png.data, 'base64'));
      results.push({ id: shot.id, ui: true, logs: logs.slice() });
      console.log(`${shot.id}: UI zrzut`);
      continue;
    }
    if (!ready) {
      results.push({ id: shot.id, error: 'timeout', logs: logs.slice() });
      console.log(`${shot.id}: TIMEOUT`, logs.slice(0, 5));
      continue;
    }
    const bakeMs = Date.now() - t0;
    const keepParts = args.czesci ? args.czesci.split(',').filter(Boolean) : (args.teren ? ['terrain'] : null);
    if (keepParts) {
      // części ringu spoza listy ukryte; hale K-7 (cullHalls ustawia visible co klatkę) — na warstwę,
      // której nie widzi żadna kamera; --bez-otoczenia: także planeta, niebo, tło i duszki dema
      await evaluate(cdp, `(() => { const r = window.__halo.ring; const keep = new Set(${JSON.stringify(keepParts)});
        for (const k of ['terrain', 'structure', 'structureTop', 'clouds', 'shell', 'mega', 'city']) if (!keep.has(k)) r.setVisible(k, false);
        if (!keep.has('k7')) for (const h of r.k7Halls || []) h.root.traverse((o) => o.layers.set(30));
        if (${args['bez-otoczenia'] ? 'true' : 'false'}) for (const o of r.group.parent.children) if (o !== r.group) o.visible = false;
        return true; })()`);
    }
    const frame = await evaluate(cdp, 'window.__halo.renderFrames(4)');
    const stats = await evaluate(cdp, 'window.__halo.stats()');
    const hdr = await evaluate(cdp, 'window.__halo.measureHDR(480)');
    await evaluate(cdp, 'window.__halo.renderFrames(1)');
    const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${shot.id}.png`), Buffer.from(png.data, 'base64'));
    // wydajność w 1440p (brief §10: „Wysoka” ≥ 60 FPS w 1440p)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: benchSize[0], height: benchSize[1], deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    await evaluate(cdp, 'window.dispatchEvent(new Event("resize")), window.__halo.renderFrames(3), true');
    const ms = await evaluate(cdp, 'window.__halo.bench(24)');
    const gpu = await evaluate(cdp, 'window.__halo.gpu');
    const build = await evaluate(cdp, '({ buildMs: window.__halo.buildMs, bake: window.__halo.bake, placeholders: window.__halo.placeholders, terrainCompileMs: window.__halo.terrainCompileMs ?? null, compileMs: window.__halo.compileMs ?? null })');
    const row = {
      id: shot.id, preset: stats.preset, mode: stats.mode, calls: frame.calls, triangles: frame.triangles,
      tiles: stats.activeTiles, segments: stats.segments, shellActive: stats.shellActive ?? null, textureMB: +(stats.textureBytes / 1048576).toFixed(0),
      ms1440: +ms.toFixed(2), fps1440: +(1000 / ms).toFixed(0), bakeMs, near: stats.near, hdr, gpu,
      buildMs: build.buildMs, bake: build.bake, placeholders: build.placeholders, terrainCompileMs: build.terrainCompileMs,
      compileMs: build.compileMs, errors: stats.errors, logs: logs.slice()
    };
    results.push(row);
    const compiled = build.compileMs ? Object.entries(build.compileMs).map(([k, v]) => `${k.replace(/^Halo/, '')} ${v == null ? '—' : Math.round(v)}`).join(', ') : null;
    console.log(`${shot.id.padEnd(18)} calls ${String(row.calls).padStart(3)}  tris ${(row.triangles / 1000).toFixed(0).padStart(5)}k  ${row.ms1440} ms (${row.fps1440} FPS @1440p)  HDR max ${hdr.max.toFixed(2)} >0.9: ${(hdr.overFraction * 100).toFixed(2)}%  NaN ${hdr.nanOrInf}  budowa ${Math.round(row.buildMs || 0)} ms  ${compiled ? `kompilacja [ms] ${compiled}` : `teren (kompilacja) ${row.terrainCompileMs == null ? '—' : Math.round(row.terrainCompileMs) + ' ms'}`}  zamienniki ${row.placeholders?.built ?? "?"}  err ${row.errors.length + row.logs.length}`);
    for (const l of [...row.errors, ...row.logs].slice(0, 4)) console.log(`    ${l.slice(0, 300)}`);
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const table = ['| ujęcie | tryb | draw calle | trójkąty | kafle | ms @1440p | FPS @1440p | HDR p99 | HDR max | >0,9 | NaN |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of results) {
    if (r.ui) continue;
    if (r.error) { table.push(`| ${r.id} | błąd: ${r.error} |||||||||| `); continue; }
    table.push(`| ${r.id} | ${r.mode} | ${r.calls} | ${(r.triangles / 1000).toFixed(0)} tys. | ${r.tiles} | ${r.ms1440} | ${r.fps1440} | ${r.hdr.p99.toFixed(2)} | ${r.hdr.max.toFixed(2)} | ${(r.hdr.overFraction * 100).toFixed(2)}% | ${r.hdr.nanOrInf} |`);
  }
  writeFileSync(join(outDir, 'results.md'), table.join('\n') + '\n');
  await closeChrome(chrome, ws, profile);
  chromeProc = null;
  chromeProfile = null;
  await server.close();
}

main().catch(async (err) => {
  console.error(err);
  // przeglądarka i jej profil nie zostają po błędzie
  if (chromeProc) await closeChrome(chromeProc, null, chromeProfile);
  chromeProc = null;
  chromeProfile = null;
  process.exit(1);
});
