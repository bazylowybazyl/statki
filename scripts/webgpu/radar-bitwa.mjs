// Koszt radaru kokpitu w DUŻEJ bitwie (2026-10-08, zgłoszenie użytkownika: „za dużo kresek przy dużych walkach,
// zmniejsz narzut ms”). Bitwa flot jak scripts/profil-bitwy-flot.mjs (skład na stronę --sklad, gracz w pustej
// przestrzeni między nimi, nieśmiertelny), radar w kopule (zasięg --zasieg km) albo po Alt (--alt 1).
//   node scripts/webgpu/radar-bitwa.mjs [--sklad 50,20,10,3] [--profile 10,35] [--prof 6] [--zasieg 20] [--alt 0]
//        [--seed 7] [--zrzut 1] [--ab HEAD] [--out .tmp/radar/bitwa] [--port 5296]
// Wynik: profil CPU (Profiler CDP) w chwilach --profile (s od pojawienia się flot): ms na klatkę gry funkcji radaru
// inkluzywnie — tarcza (updateRadar kokpitu: krok śledzenia + rysunek), zbieracz (refreshRadarFeed), skan X i
// znaczniki krawędzi; rozbicie rysunku tarczy na warstwy; liczniki (ślady, rekordy, echa) i zrzut tarczy.
// --ab <ref git>: na końcu gra stoi (pauza) i ta sama klatka bitwy idzie przez tarczę i znaczniki krawędzi
// z <ref> (kopia z gita w .tmp/radar-ab) i z drzewa roboczego — bloki na przemian, ms na rysunek (mediana).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startVite, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome, parseArgs, repo } from './wspolne.mjs';

const args = parseArgs();
const SKLAD = String(args.sklad || '50,20,10,3').split(',').map((v) => Math.max(0, Number(v) || 0));
const [NF, ND, NB, NS] = [SKLAD[0] || 0, SKLAD[1] || 0, SKLAD[2] || 0, SKLAD[3] || 0];
const PROF = Number(args.prof || 6);
const PROFILE_AT = String(args.profile || '10,35').split(',').map(Number).filter((v) => v >= 0);
const RANGE = Number(args.zasieg || 20) * 1000;
const ALT = String(args.alt || '0') === '1';
const SEED = args.seed ?? '7';
const OUT = resolve(repo, args.out || '.tmp/radar/bitwa');
mkdirSync(OUT, { recursive: true });
const AB = args.ab ? String(args.ab) : null;
const AB_URL = AB ? materialize(AB) : null;

// Wersja radaru i znaczników z gita do .tmp/radar-ab/<ref>/ (importy spoza katalogu radaru — od korzenia).
function materialize(ref) {
  const safe = ref.replace(/[^\w.-]/g, '_');
  const dir = join(repo, '.tmp', 'radar-ab', safe);
  mkdirSync(join(dir, 'radar'), { recursive: true });
  const git = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 });
  const files = git(['ls-tree', '--name-only', ref, 'src/ui/radar/']).split(/\r?\n/).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const src = git(['show', `${ref}:${f}`]).replace(/from '\.\.\/\.\.\//g, "from '/src/").replace(/from '\.\.\//g, "from '/src/ui/");
    writeFileSync(join(dir, 'radar', f.split('/').pop()), src);
  }
  writeFileSync(join(dir, 'contactMarkers.js'), git(['show', `${ref}:src/ui/contactMarkers.js`]));
  return `/.tmp/radar-ab/${safe}`;
}

const { server, base } = await startVite(Number(args.port || 5296));
const chrome = await startChrome({ width: 1920, height: 1080, webgpu: false });
const { cdp, logs } = chrome;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
    localStorage.setItem('sc_radar_range', '${RANGE}'); localStorage.setItem('sc_radar_orient', 'head'); } catch {}
  let s = ${Number(SEED) >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();` });
const ev = (expr) => evaluate(cdp, expr);
const report = (label, value) => console.log(String(label).padEnd(12), typeof value === 'string' ? value : JSON.stringify(value));
const errors = () => logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));

// Liczniki radaru (stan tej chwili).
const STATE = `(() => {
  const c = window.cockpitUI, r = c?.radar, f = c?.radarModel, d = r?.display;
  const tr = r?.tracker; let hostile = 0, friendly = 0, missiles = 0;
  for (const t of (tr?.list || [])) { if (t.kind === 'missile') missiles++; else if (t.aff === 'hostile') hostile++; else if (t.aff === 'friendly') friendly++; }
  return { slady: tr?.list.length, wrogie: hostile, swoje: friendly, rakiety: missiles, rekordy: f?.count,
    echa: d?.stats.echoes, symbole: d?.stats.tracks, tarczaMs: +(r?.stats.drawMs || 0).toFixed(3), krokMs: +(r?.stats.stepMs || 0).toFixed(3),
    zbieraczMs: +(f?.collectMs || 0).toFixed(3), plotno: c?.els?.radarCanvas?.width, tryb: c?.pointerMode ? 'full' : 'dome',
    fps: Math.round(window.__PH?.display?.fps || 0), npc: (window.npcs || []).filter((n) => !n.dead).length };
})()`;

try {
  const ready = await navigateAndWait(cdp, `${base}/index.html?dev=1`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  let started = false;
  for (let t0 = Date.now(); !started && Date.now() - t0 < 240000;) {
    await sleep(250);
    try { started = await ev('(window.__frameId || 0) > 30 && !!window.camera && !!window.cockpitUI'); } catch { /* ładuje się */ }
  }
  report('gra', { ready, started });
  await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle(); return true; })()`);
  // Pusta przestrzeń między Wenus a Ziemią (jak profil-bitwy-flot.mjs), gracz nieśmiertelny.
  report('miejsce', await ev(`(() => {
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin };
    }
    window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.1;
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    ${ALT ? 'window.cockpitUI.setPointerMode?.(true);' : ''}
    return { x: Math.round(best.x), y: Math.round(best.y), alt: ${ALT}, pointerMode: !!window.cockpitUI.pointerMode };
  })()`));
  await sleep(3000);
  report('spawn', await ev(`(() => {
    const s = window.ship, a = 0, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = { piraci: 0, tn: 0 };
    const put = (key, mode, pos, ang) => { const r = window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: ang });
      const k = Array.isArray(r) ? r.length : (r ? 1 : 0); if (mode === 'pirate') out.piraci += k; else out.tn += k; };
    const block = (key, mode, k, fwd0, rowGap, spacing, perRow, dir, ang) => {
      for (let i = 0; i < k; i++) { const row = Math.floor(i / perRow), inRow = Math.min(perRow, k - row * perRow), j = i - row * perRow;
        put(key, mode, at(fwd0 + dir * row * rowGap, (j - (inRow - 1) / 2) * spacing), ang); } };
    block('frigate_pd', 'pirate', ${NF}, 7000, 700, 650, 25, 1, a + Math.PI);
    block('destroyer', 'pirate', ${ND}, 8600, 900, 900, 20, 1, a + Math.PI);
    block('pirate_battleship', 'pirate', ${NB}, 10600, 1500, 1500, 10, 1, a + Math.PI);
    block('pirate_supercapital', 'pirate', ${NS}, 13500, 3500, 4000, 5, 1, a + Math.PI);
    block('frigate_laser', 'friendly', ${NF}, -1500, 700, 650, 25, -1, a);
    block('destroyer', 'friendly', ${ND}, -3100, 900, 900, 20, -1, a);
    block('battleship', 'friendly', ${NB}, -5100, 1500, 1500, 10, -1, a);
    block('supercapital', 'friendly', ${NS}, -8000, 3500, 4000, 5, -1, a);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.1;
    return out;
  })()`));

  const t0 = Date.now();
  const sec = () => (Date.now() - t0) / 1000;
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  const results = [];
  for (const at of PROFILE_AT.sort((a, b) => a - b)) {
    while (sec() < at) await sleep(200);
    const s0 = await ev(STATE);
    const f0 = await ev('window.__frameId');
    await cdp.send('Profiler.start');
    await sleep(PROF * 1000);
    const { profile } = await cdp.send('Profiler.stop');
    const frames = (await ev('window.__frameId')) - f0;
    const s1 = await ev(STATE);
    writeFileSync(join(OUT, `radar-t${at}.cpuprofile`), JSON.stringify(profile));
    const a = analyze(profile, frames);
    results.push({ at, frames, stan: s1, ...a });
    report(`t=${at}`, { klatek: frames, fps: +(frames / PROF).toFixed(1), stan: s1 });
    print(a);
    if (String(args.zrzut || '1') === '1') {
      const png = await ev(`(() => window.cockpitUI.els.radarCanvas.toDataURL('image/png'))()`);
      writeFileSync(join(OUT, `tarcza-t${at}.png`), Buffer.from(png.split(',')[1], 'base64'));
    }
    void s0;
  }
  let ab = null;
  if (AB_URL) {
    ab = await ev(AB_EXPR(AB_URL));
    report('A/B', `${AB} (A) ↔ drzewo robocze (B), ta sama klatka bitwy w pauzie`);
    for (const k of Object.keys(ab)) {
      if (k.startsWith('png_')) {
        ab[k].forEach((url, i) => writeFileSync(join(OUT, `ab-${k.slice(4)}-${i ? 'B' : 'A'}.png`), Buffer.from(url.split(',')[1], 'base64')));
        delete ab[k];
        continue;
      }
      console.log(`  ${k.padEnd(22)} ${JSON.stringify(ab[k])}`);
    }
  }
  writeFileSync(join(OUT, 'wyniki.json'), JSON.stringify({ sklad: SKLAD, zasieg: RANGE, alt: ALT, results, ab }, null, 1));
  report('błędy', errors().slice(0, 12));
} catch (e) {
  console.log('BŁĄD', e.stack || e.message, errors().slice(0, 10));
} finally {
  await chrome.close();
  await server.close();
  process.exit(0);
}

// A/B na zatrzymanej klatce: tarcza (kopuła i Alt) i znaczniki krawędzi, stara ↔ nowa wersja na tym samym wejściu.
function AB_EXPR(base) {
  return `(async () => {
    window.__setGamePaused?.(true);
    await new Promise((r) => setTimeout(r, 300));
    const [OldR, NewR, OldM, NewM] = await Promise.all([import('${base}/radar/cockpitRadar.js'), import('/src/ui/radar/cockpitRadar.js'),
      import('${base}/contactMarkers.js'), import('/src/ui/contactMarkers.js')]);
    const feed = Object.assign({}, window.cockpitUI.radarModel);
    feed.paused = false;
    const W = window.cockpitUI.els.radarCanvas.width;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = W; return c.getContext('2d'); };
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return +b[b.length >> 1].toFixed(4); };
    const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4);
    const out = {};
    for (const mode of ['dome', 'full']) {
      const sides = [{ r: new OldR.CockpitRadar(), ctx: mk(), t: [] }, { r: new NewR.CockpitRadar(), ctx: mk(), t: [] }];
      let now = 1000;
      const opts = { mode, dpr: 1, shrink: mode === 'dome' ? 0.842857 : 1, now: 0 };
      for (const s of sides) { s.r.range = s.r.rangeShown = window.cockpitUI.radar.range; s.r.orient = 'head'; s.r.orientBlend = 1; }
      // rozgrzewka: 3 obroty anteny (ślady dojrzałe)
      for (let i = 0; i < 240; i++) { now += 33.3; opts.now = now; for (const s of sides) s.r.render(s.ctx, W, W, feed, opts); }
      for (let b = 0; b < 16; b++) {
        for (const s of (b & 1 ? sides.slice().reverse() : sides)) {
          let n2 = now;
          for (let i = 0; i < 30; i++) { n2 += 33.3; opts.now = n2; const t0 = performance.now(); s.r.render(s.ctx, W, W, feed, opts); s.t.push(performance.now() - t0); }
        }
        now += 30 * 33.3;
      }
      out['tarcza_' + mode] = { A_med: med(sides[0].t), B_med: med(sides[1].t), A_sr: avg(sides[0].t), B_sr: avg(sides[1].t),
        slady: sides[1].r.tracker.list.length, symboleB: sides[1].r.display.stats.tracks, symboleA: sides[0].r.display.stats.tracks };
      // ostatni rysunek obu wersji (ten sam stan anteny) — do porównania obrazu
      out['png_' + mode] = [sides[0].ctx.canvas.toDataURL('image/png'), sides[1].ctx.canvas.toDataURL('image/png')];
    }
    const c = document.createElement('canvas'); c.width = innerWidth; c.height = innerHeight;
    const ctx = c.getContext('2d');
    const layout = { bottom: Math.round(118 * (window.cockpitUI?.scale || 1)), skip: () => false };
    const args = [ctx, c.width, c.height, window.ship, window.SensorSystem, 12.5, window.camera, null, false, layout];
    const mt = [[], []];
    for (let i = 0; i < 60; i++) { OldM.ContactMarkers.draw(...args); NewM.ContactMarkers.draw(...args); }
    for (let b = 0; b < 16; b++) {
      for (const k of (b & 1 ? [1, 0] : [0, 1])) {
        const M = k ? NewM : OldM;
        for (let i = 0; i < 60; i++) { const t0 = performance.now(); M.ContactMarkers.draw(...args); mt[k].push(performance.now() - t0); }
      }
    }
    out.znacznikiKrawedzi = { A_med: med(mt[0]), B_med: med(mt[1]), A_sr: avg(mt[0]), B_sr: avg(mt[1]) };
    // obraz znaczników obu wersji (ta sama klatka)
    const shots = [];
    for (const M of [OldM, NewM]) { ctx.clearRect(0, 0, c.width, c.height); M.ContactMarkers.draw(...args); shots.push(c.toDataURL('image/png')); }
    out.png_znaczniki = shots;
    window.__setGamePaused?.(false);
    return out;
  })()`;
}

// Inkluzywny czas funkcji (bez podwójnego liczenia rekurencji) na klatkę gry.
function analyze(profile, frames) {
  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, { ...n, self: 0, total: 0, parent: null });
  for (const n of nodes.values()) for (const c of (n.children || [])) nodes.get(c).parent = n;
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) nodes.get(samples[i]).self += (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000;
  const totalOf = (n) => { let t = n.self; for (const c of (n.children || [])) t += totalOf(nodes.get(c)); n.total = t; return t; };
  for (const n of nodes.values()) if (!n.parent) totalOf(n);
  const file = (n) => n.callFrame.url.split('/').pop().split('?')[0];
  const per = (ms) => +(ms / Math.max(1, frames)).toFixed(4);
  // suma najwyższych wystąpień funkcji (fname, plik)
  const incl = (fname, fileRe) => {
    let sum = 0;
    for (const n of nodes.values()) {
      if (n.callFrame.functionName !== fname || !fileRe.test(file(n))) continue;
      let nested = false;
      for (let p = n.parent; p; p = p.parent) if (p.callFrame.functionName === fname && fileRe.test(file(p))) { nested = true; break; }
      if (!nested) sum += n.total;
    }
    return per(sum);
  };
  // cały kod z plików radaru wołany spoza nich (korzenie poddrzew radaru)
  const radarFile = /^(radar\w*|cockpitRadar|scanOverlay|contactMarkers)\.js$/;
  let radarRoots = 0;
  for (const n of nodes.values()) {
    if (!radarFile.test(file(n))) continue;
    let p = n.parent;
    while (p && !p.callFrame.url) p = p.parent;   // natywne bez pliku
    if (p && radarFile.test(file(p))) continue;
    radarRoots += n.total;
  }
  // dzieci rysunku tarczy (draw w radarDisplay.js) wg nazwy
  const layers = new Map();
  for (const n of nodes.values()) {
    if (n.callFrame.functionName !== 'draw' || file(n) !== 'radarDisplay.js') continue;
    for (const cid of (n.children || [])) {
      const c = nodes.get(cid);
      const k = c.callFrame.functionName || '(anon)';
      layers.set(k, (layers.get(k) || 0) + c.total);
    }
    layers.set('(self draw)', (layers.get('(self draw)') || 0) + n.self);
  }
  const layerList = [...layers.entries()].sort((a, b) => b[1] - a[1]).filter(([, v]) => per(v) >= 0.002).map(([k, v]) => [k, per(v)]);
  // self-time w plikach radaru (+ natywne wołane wprost z nich)
  const self = new Map();
  for (const n of nodes.values()) {
    let owner = n;
    if (!n.callFrame.url) { owner = n.parent; while (owner && !owner.callFrame.url) owner = owner.parent; }
    if (!owner || !radarFile.test(file(owner))) continue;
    const k = n.callFrame.url ? `${n.callFrame.functionName || '(anon)'} ${file(n)}:${n.callFrame.lineNumber + 1}`
      : `[natywne] ${n.callFrame.functionName} ← ${owner.callFrame.functionName} ${file(owner)}`;
    self.set(k, (self.get(k) || 0) + n.self);
  }
  const selfList = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => [k, per(v)]);
  return {
    msNaKlatke: {
      tarcza_updateRadar: incl('updateRadar', /^cockpitUI\.js$/),
      krok_stepRadarTracker: incl('stepRadarTracker', /^radarTracker\.js$/),
      rysunek_draw: incl('draw', /^radarDisplay\.js$/),
      podklad_update: incl('update', /^radarTerrain\.js$/),
      zbieracz_refreshRadarFeed: incl('refreshRadarFeed', /^index\.html$/),
      zbieracz_collect: incl('collect', /^radarFeed\.js$/),
      skanX: incl('draw', /^scanOverlay\.js$/),
      znacznikiKrawedzi: incl('draw', /^contactMarkers\.js$/),
      radarRazem: per(radarRoots)
    },
    warstwy: layerList,
    self: selfList
  };
}

function print(a) {
  console.log('  ms/klatkę gry:', JSON.stringify(a.msNaKlatke));
  console.log('  warstwy tarczy:', a.warstwy.map(([k, v]) => `${k} ${v}`).join(' | '));
  for (const [k, v] of a.self) console.log(`    ${String(v).padStart(7)}  ${k}`);
}
