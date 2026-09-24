// Automatyczne zrzuty dema ringu Halo (brief §13–§14): Vite + headless Chrome
// przez CDP (bez zależności — WebSocket z Node 22). Dla każdego ujęcia:
// zrzut PNG, draw calle, trójkąty, ms/klatkę, histogram HDR, błędy shaderów.
//
//   node scripts/halo-ring-shots.mjs --set m2 --out .tmp/halo-ring/m2
//   node scripts/halo-ring-shots.mjs --only p1,p8 --size 2560x1440
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const repo = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const outDir = resolve(repo, args.out || '.tmp/halo-ring');
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
  { id: 'lm5_game_night_z045', q: { landmark: 5, cam: 'game', zoom: 0.45, night: 1 } }
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
    'lm1_game_z1', 'lm5_game_night_z045', 'p6', 'p9', 'm4_city_z1', 'k7_docked_z035']
};

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

async function main() {
  const server = await createServer({ root: repo, logLevel: 'error', server: { port: 5230, strictPort: false } });
  await server.listen();
  const port = server.config.server.port;
  const base = `http://localhost:${server.httpServer.address().port}`;
  void port;
  const profile = join(tmpdir(), `halo-shots-${Date.now()}`);
  const dbgPort = 9333 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${dbgPort}`, `--user-data-dir=${profile}`,
    '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--hide-scrollbars',
    `--window-size=${W},${H}`, 'about:blank'
  ], { stdio: 'ignore' });
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
      logs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
    }
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`);
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const results = [];
  for (const shot of shots) {
    logs.length = 0;
    const q = new URLSearchParams({ ...(shot.ui ? {} : { shot: '1' }), quality, seed: '1337', ...Object.fromEntries(Object.entries(shot.q).map(([k, v]) => [k, String(v)])) });
    const url = `${base}/dema/halo_ring_demo.html?${q}`;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    const t0 = Date.now();
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
    const gpu = await evaluate(cdp, `(() => { const gl = document.getElementById('view').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`);
    const row = {
      id: shot.id, preset: stats.preset, mode: stats.mode, calls: frame.calls, triangles: frame.triangles,
      tiles: stats.activeTiles, segments: stats.segments, textureMB: +(stats.textureBytes / 1048576).toFixed(0),
      ms1440: +ms.toFixed(2), fps1440: +(1000 / ms).toFixed(0), bakeMs, near: stats.near, hdr, gpu,
      errors: stats.errors, logs: logs.slice()
    };
    results.push(row);
    console.log(`${shot.id.padEnd(18)} calls ${String(row.calls).padStart(3)}  tris ${(row.triangles / 1000).toFixed(0).padStart(5)}k  ${row.ms1440} ms (${row.fps1440} FPS @1440p)  HDR max ${hdr.max.toFixed(2)} >0.9: ${(hdr.overFraction * 100).toFixed(2)}%  NaN ${hdr.nanOrInf}  err ${row.errors.length + row.logs.length}`);
  }
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  const table = ['| ujęcie | tryb | draw calle | trójkąty | kafle | ms @1440p | FPS @1440p | HDR p99 | HDR max | >0,9 | NaN |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of results) {
    if (r.ui) continue;
    if (r.error) { table.push(`| ${r.id} | błąd: ${r.error} |||||||||| `); continue; }
    table.push(`| ${r.id} | ${r.mode} | ${r.calls} | ${(r.triangles / 1000).toFixed(0)} tys. | ${r.tiles} | ${r.ms1440} | ${r.fps1440} | ${r.hdr.p99.toFixed(2)} | ${r.hdr.max.toFixed(2)} | ${(r.hdr.overFraction * 100).toFixed(2)}% | ${r.hdr.nanOrInf} |`);
  }
  writeFileSync(join(outDir, 'results.md'), table.join('\n') + '\n');
  ws.close();
  chrome.kill();
  await server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
