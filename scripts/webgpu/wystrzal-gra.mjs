// GAZ PRZY WYSTRZALE Z LUFY (etap E1 wybuchów i dymu WebGPU — armata, Yamato z niebieskim ogniem; reżyser
// src/3d/explosions/explosionFx.js: MUZZLE_GAS, domeny wystrzałów) w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU
// (CDP), harness czasu wirtualnego (scripts/webgpu/harness-strona.js — klatka 1/60 s, zrzuty na zatrzymanej klatce).
//
//   node scripts/webgpu/wystrzal-gra.mjs [--tryb sceny,dok,bitwa] [--sceny yamato,armata,ruch,bronie3d] [--out .tmp/wystrzal-gra]
//        [--rozmiar 1600x900] [--port 5379] [--zoom 0.45] [--sklad 24,10,5,1] [--bitwa 25] [--zgony 2] [--zoomBitwy 0.3]
//
// sceny (gra swobodna, pustka, Atlas stoi; cel ćwiczebny bez mózgu): strzał gracza → zrzuty 0,03…1,2 s po strzale w
//   wariantach (każdy wariant to osobny strzał tego samego działa w tym samym miejscu):
//   yamato   — salwa Yamato (DevScene.fireSpecial): gaz | bez gazu (muzzleGas false) | gaz + pełny dym cząstkowy (smokeK 1)
//              + A/B TEJ SAMEJ klatki: paleta ognia domeny 0 (ciało czarne) zamiast 1 (plazma),
//   armata   — armata na gniazdach main (strzela kierowanie ogniem na auto): gaz | bez gazu | strzelec w masce przeszkód
//              swojej domeny (muzzleHostExclude false — wylot nad pokładem na pryzmacie własnego kadłuba),
//   ruch     — Atlas w ruchu (W + dopalacz) i salwa Yamato: nośnik domeny = prędkość lufy | 0 (dym zostaje w świecie),
//   bronie3d — opcja „Bronie 3D” (wieże 3D, błysk na wysokości lufy): salwa Yamato.
// dok (misja 1, ?story=ram): Atlas przy bramie taranowej suchego doku, armata w stronę doku — gaz z lufy przy statyce.
// bitwa (czas rzeczywisty, gra swobodna): floty z --sklad (piraci z armatą w gniazdach main), Atlas z Yamato w bitwie
//   (salwa co ~5,5 s), --zgony okrętów w kadrze na sekundę ginie (wybuchy z gazu biorą domeny); odcinki po 6 s z gazem
//   wylotu i bez NAPRZEMIENNIE (ABBA): czasy klatek (średnia, p95, najgorsza), GPU klatki, domeny wystrzałów (najwięcej
//   naraz), wystrzały z gazem / bez domeny / za małe, wybuchy: gaz / cząstki / noSlot / przejęte domeny wystrzałów.
// Raport: <out>/raport.json — liczniki, pipeline'y SYNCHRONICZNE w klatkach scen (ma być 0), Core3D.tslUuid.kolizje (0),
// błędy konsoli. Skrypt nie robi reseed (pułapka 38).
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const tryby = String(args.tryb || 'sceny').split(',');
const sceny = String(args.sceny || 'yamato,armata,ruch,bronie3d').split(',');
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/wystrzal-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const ZOOM = Number(args.zoom || 0.45);
const SKLAD = String(args.sklad || '24,10,5,1').split(',').map((v) => Math.max(0, Number(v) || 0));
const BITWA = Number(args.bitwa ?? 25);
const ZGONY = Number(args.zgony ?? 2);
const ZOOM_BITWY = Number(args.zoomBitwy || 0.3);
const TIMES = String(args.czasy || '0.03,0.08,0.15,0.3,0.5,0.8,1.2').split(',').map(Number);
const DIAG = !!args.diag;
const CEL = Number(args.cel || 3300);   // odległość celu ćwiczebnego przed dziobem [j.]   // ujęcie „sam gaz” przy każdym kadrze
const ZA = Number(args.zoomArmata || 0.7);   // zoom kadru armaty

const { server, base } = await startVite(Number(args.port || 5379));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { sceny: {}, dok: null, bitwa: null, bledy: [] };

const stats = () => ev(`(() => {
  const x = window.__explosions; if (!x) return null;
  const s = x.stats, g = x.grid;
  const mz = []; for (const sl of g.slots) if (sl.active && sl.tag === 7) mz.push({ h: +sl.h.toFixed(1), fire: sl.fire, fade: +sl.fade.toFixed(2), hosts: sl.hostN, v: Math.round(Math.hypot(sl.vx, sl.vy)) });
  return { mzShots: s.mzShots, mzGas: s.mzGas, mzNoSlot: s.mzNoSlot, mzSmall: s.mzSmall, mzOff: s.mzOff, mzTaken: s.mzTaken, mzMax: s.mzMax,
    domeny: g.stats.active, mz, zrodla: g.stats.sources, kadluby: g.stats.hulls, gasMuzzles: window.WeaponFx.stats.gasMuzzles,
    wybuchy: { spawned: s.spawned, gas: s.gas, particles: s.particles, noSlot: s.noSlot }, cpu: +s.cpuMs.toFixed(3) };
})()`);
const pipesSince = (k0) => ev(`(() => {
  const p = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && !e.budowa);
  const sync = p.filter((e) => e.sync && !e.compute);
  const comp = p.filter((e) => e.compute);
  const nb = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && e.budowa && !e.poza);
  return { sync: sync.length, compute: comp.length, budowyWKlatce: nb.length, lista: [...new Set(sync.map((e) => e.nazwa))].slice(0, 12),
    compLista: [...new Set(comp.map((e) => e.nazwa))].slice(0, 12), nbLista: [...new Set(nb.map((e) => e.nazwa))].slice(0, 12) };
})()`);
const frameK = () => ev('window.__harness.frameLog.n');
const camAt = (x, y, zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  c.transition = null; window.DevScene?.syncCamera?.();
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  return true;
})()`);

const shipCamAt = (z) => ev(`(() => { const c = window.camera; c.mode = 'ship'; c.focusStation = null; c.transition = null; c.manualZoom = true;
  c.zoom = c.targetZoom = c.zoomBase = ${z}; document.getElementById('cockpit-ui-host')?.classList.add('hidden'); return true; })()`);

// Dziennik strzałów gracza (szyna strzałów: broń, wylot) i wybór wylotu do kadru.
const INSTRUMENT = `(() => {
  if (window.__mz) return true;
  const M = window.__mz = { shots: [] };
  window.WeaponShotBus.on((d) => { if (d.shooter !== window.ship) return; M.shots.push({ w: d.weaponId, x: d.x, y: d.y, k: window.__harness?.frameLog?.n ?? 0 }); });
  return true;
})()`;

// Strzał gracza i czekanie na zdarzenie strzału broni z rodziny (zegar wirtualny): yamato — spust special (co 20 klatek
// ponawiany, wieże muszą dojść do kursora), armata — kierowanie ogniem na auto. Zwraca wylot pierwszego strzału.
const fireAndWait = (fam, max = 600) => ev(`(async () => {
  const M = window.__mz, H = window.__harness, n0 = M.shots.length;
  const ok = (s) => ${fam === 'yamato' ? "/yamato/.test(s.w)" : "s.w === 'armata_mk1'"};
  for (let k = 0; k < ${max}; k++) {
    if (window.fireControl) window.fireControl.storyHold = false;   // misja 1 (faza ram) wstrzymuje ogień wież na auto
    if (${fam === 'yamato'} && k % 20 === 0) window.DevScene.fireSpecial();
    await H.step(1);
    const hit = M.shots.slice(n0).filter(ok);
    if (hit.length) return { k, x: hit[0].x, y: hit[0].y, n: hit.length };
  }
  return null;
})()`);

async function shot(name) {
  await ev('window.__harness.frames(2)');
  await sleep(80);
  await screenshotPng(cdp, join(out, `${name}.png`));
}

// Seria zrzutów po strzale (czasy TIMES od strzału), A/B tej samej klatki (palette: paleta ognia domen wystrzałów 1 → 0).
async function series(prefix, palette = false) {
  const rows = [];
  let tNow = 0;
  for (const at of TIMES) {
    const n = Math.round((at - tNow) * 60);
    if (n > 0) await ev(`window.__harness.step(${n})`);
    tNow = at;
    const name = `${prefix}-${String(at).replace('.', '_')}`;
    await shot(name);
    if (DIAG) {
      // „sam gaz”: pule WeaponFx, pociski i smugi poza passami (warstwa 31), światła efektów wyłączone — ta sama klatka.
      await ev(`(async () => { const F = window.WeaponFx; window.__dg = [...F.gpu.meshes, F.projectiles.mesh, F.trails.mesh, F.beams.mesh].map((m) => [m, m.layers.mask]);
        for (const [m] of window.__dg) m.layers.set(31); window.Core3D.fx.lights.enabled = false; await window.__harness.frames(2); return true; })()`);
      await sleep(80);
      await screenshotPng(cdp, join(out, `${name}-samGaz.png`));
      await ev(`(async () => { for (const [m, mk] of window.__dg) m.layers.mask = mk; window.Core3D.fx.lights.enabled = true; await window.__harness.frames(1); return true; })()`);
    }
    if (palette && (at === 0.08 || at === 0.1 || at === 0.25 || at === 0.3)) {
      await ev(`(async () => { const g = window.__explosions.grid; window.__palPrev = g.slots.map((s) => s.fire);
        for (const s of g.slots) if (s.active && s.tag === 7) s.fire = 0; await window.__harness.frames(2); return true; })()`);
      await sleep(80);
      await screenshotPng(cdp, join(out, `${name}-paleta0.png`));
      await ev(`(async () => { const g = window.__explosions.grid; g.slots.forEach((s, i) => { s.fire = window.__palPrev[i]; }); await window.__harness.frames(1); return true; })()`);
      // A/B: błyski wylotu bez właściciela (światło lufy także w bliskim polu swojego dymu — podwójna poświata?)
      await ev(`(async () => { const L = window.Core3D.fx.lights; window.__owPrev = L.fowner.slice(); L.fowner.fill(0); await window.__harness.frames(2); return true; })()`);
      await sleep(80);
      await screenshotPng(cdp, join(out, `${name}-wlasciciel0.png`));
      await ev(`(async () => { window.Core3D.fx.lights.fowner.set(window.__owPrev); await window.__harness.frames(1); return true; })()`);
    }
    const st = await stats();
    if (args.sonda) {
      // przekrój domen wystrzałów na wysokości źródeł (dym, max i suma; prędkość max) — GPU → CPU
      st.sonda = await ev(`(async () => { const X = window.__explosions, g = X.grid, out = [];
        for (const sl of g.slots) { if (!sl.active || sl.tag !== 7) continue;
          for (const zc of [g.NZ / 2, g.NZ / 2 + 5]) { const a = await g.probeSlice(window.Core3D.renderer, sl.index, zc); let mx = 0, sm = 0, vm = 0;
            for (let i = 0; i < a.length; i += 4) { mx = Math.max(mx, a[i + 1]); sm += a[i + 1]; vm = Math.max(vm, Math.hypot(a[i + 2], a[i + 3])); }
            out.push({ slot: sl.index, z: zc, dymMax: +mx.toFixed(3), dymSuma: +sm.toFixed(1), vMax: +vm.toFixed(1) }); } }
        return out; })()`);
    }
    console.log(name.padEnd(28), JSON.stringify(st));
    rows.push({ t: at, ...st });
  }
  return rows;
}

// Wariant: strojenie reżysera na czas strzału (potem wartości gry), kamera nad wylotem pierwszego strzału.
async function variant(scene, fam, label, tune, palette = false, zoom = ZOOM, shipCam = false) {
  await ev(`(() => { const T = window.__explosions.tune; window.__tPrev = {}; for (const [k, v] of Object.entries(${JSON.stringify(tune)})) { window.__tPrev[k] = T[k]; T[k] = v; } return true; })()`);
  const s0 = await stats();
  await ev('(() => { try { window.refillPlayerAmmo?.(); } catch (e) { /* */ } return true; })()');
  // cel padł (trafienia niszczą komorę rdzenia — detonacja mimo punktów) — nowy w tym samym miejscu
  const tg = await ev('(() => { const t = window.__mzTarget; return t && !t.dead && window.npcs.includes(t) ? null : window.__mzTargetAt; })()');
  if (tg) await target(tg.x, tg.y, tg.key);
  // armata: wieże na auto strzelają tylko w wariancie (w przerwie wstrzymane — domeny poprzedniego wariantu wygasają)
  if (fam === 'armata') await ev(`(() => { if (window.fireControl) window.fireControl.posture = 'free'; return true; })()`);
  const f = await fireAndWait(fam);
  if (!f) { console.log(scene, label, 'BRAK STRZAŁU'); await ev('(() => { Object.assign(window.__explosions.tune, window.__tPrev); return true; })()'); return { label, strzal: null }; }
  // kadr: nad wylotem (kamera RTS) albo kamera statku (okręt w ruchu — W / Shift działają tylko w kamerze statku)
  if (shipCam) await shipCamAt(zoom); else await camAt(f.x, f.y, zoom);
  const rows = await series(`${scene}-${label}`, palette);
  await ev(`(() => { Object.assign(window.__explosions.tune, window.__tPrev); if (window.fireControl) window.fireControl.posture = 'hold'; return true; })()`);
  const s1 = await stats();
  // przerwa: domeny wystrzałów wygasają, Yamato przeładowuje (5 s)
  await ev('window.__harness.step(330)');
  return { label, tune, strzal: f, przed: s0, rows, po: s1 };
}

async function startFree() {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
    localStorage.setItem('sc_ships3d', '0'); localStorage.setItem('sc_weapons3d', '0'); } catch {} })();\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  await waitFor(cdp, '!!window.__harness', 60000, 100);
  await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await sleep(800);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30 && !!window.camera && !!window.__explosions && !!window.DevScene?.mountMain', 300000, 400)) throw new Error('gra swobodna nie ruszyła');
  await sleep(2000);
  await ev(INSTRUMENT);
  // Pusta przestrzeń między Wenus a Ziemią (jak zbiornik-gra), gracz nieśmiertelny, bez mgły wojny.
  return ev(`(() => {
    window.setFogOfWar?.(false);
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
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    return { x: best.x, y: best.y };
  })()`);
}

// Cel ćwiczebny (bez mózgu, bez tarczy, nie ginie) w (x, y): wieże gracza mają w co celować.
const target = (x, y, key = 'pirate_battleship') => ev(`(async () => {
  const r = window.spawnCallInShip('${key}', { mode: 'pirate', spawnPos: { x: ${x}, y: ${y} }, pos: { x: ${x}, y: ${y} }, spawnAngle: Math.PI / 2 });
  const e = Array.isArray(r) ? r[0] : r; if (!e) return null;
  e.ai = () => {}; e.hp = e.maxHp = 1e8; if (e.shield) { e.shield.max = 0; e.shield.val = 0; } e.__fogVisible = true;
  window.__mzTarget = e; window.__mzTargetAt = { x: ${x}, y: ${y}, key: '${key}' };
  for (let i = 0; i < 60 && !e.beamHull; i++) await window.__harness.step(1);
  return { hull: !!e.beamHull };
})()`);

try {
  if (tryby.includes('sceny')) {
    const P = await startFree();
    console.log('miejsce', JSON.stringify(P));
    await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
    await ev('window.__harness.step(20)');
    const fit = await ev(`(() => {
      window.DevScene.mountMissile(null);
      const ns = window.DevScene.mountSpecial('special_yamato_cannon'${args.yamato ? ', ' + Number(args.yamato) : ''});
      const nm = window.DevScene.mountMain('armata_mk1');
      if (window.fireControl) { window.fireControl.posture = 'hold'; }
      return { special: ns, main: nm, tier: window.ship.weaponTier || null };
    })()`);
    console.log('fit', JSON.stringify(fit));
    report.fit = fit;
    // Cel przed dziobem (kurs 0 = +x): Yamato (7 km) i armata (3,5 km) w zasięgu; trafienia poza kadrem wylotu.
    await ev(`(() => { window.DevScene.teleport(${P.x}, ${P.y}, 0); window.ship.angVel = 0; return true; })()`);
    report.cel = await target(P.x + CEL, P.y + 300);
    await ev(`window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300})`);
    await ev('window.__harness.step(60)');
    const k0 = await frameK();

    if (sceny.includes('yamato')) {
      const k1 = await frameK();
      const rows = [];
      rows.push(await variant('yamato', 'yamato', 'gaz', {}, true));
      rows.push(await variant('yamato', 'yamato', 'bez', { muzzleGas: false }));
      rows.push(await variant('yamato', 'yamato', 'dym1', { muzzleSmokeK: 1 }));
      report.sceny.yamato = { rows, pipeline: await pipesSince(k1) };
      console.log('yamato pipeline', JSON.stringify(report.sceny.yamato.pipeline));
    }
    if (sceny.includes('armata')) {
      const k1 = await frameK();
      // cel w zasięgu armaty (3,5 km)
      await ev(`(() => { const t = window.__mzTarget; t.x = ${P.x} + 2600; t.y = ${P.y} + 300; if (t.pos) { t.pos.x = t.x; t.pos.y = t.y; } t.vx = 0; t.vy = 0;
        window.DevScene.pointerAt(t.x, t.y); if (window.fireControl) window.fireControl.posture = 'free'; return true; })()`);
      const rows = [];
      rows.push(await variant('armata', 'armata', 'gaz', {}, false, ZA));
      rows.push(await variant('armata', 'armata', 'bez', { muzzleGas: false }, false, ZA));
      rows.push(await variant('armata', 'armata', 'host0', { muzzleHostExclude: false }, false, ZA));
      await ev(`(() => { if (window.fireControl) window.fireControl.posture = 'hold'; return true; })()`);
      report.sceny.armata = { rows, pipeline: await pipesSince(k1) };
      console.log('armata pipeline', JSON.stringify(report.sceny.armata.pipeline));
    }
    if (sceny.includes('ruch')) {
      const k1 = await frameK();
      const keyEv = (type, k, code, vk) => cdp.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
      const rows = [];
      for (const [label, tune] of [['nosnik', {}], ['nosnik0', { muzzleCarrier: 0 }]]) {
        await ev(`(() => { window.DevScene.teleport(${P.x} - 3000, ${P.y} - 2500, 0); window.ship.angVel = 0; return true; })()`);
        await ev(`window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300})`);
        await shipCamAt(0.3);
        await keyEv('keyDown', 'w', 'KeyW', 87);
        await keyEv('keyDown', 'Shift', 'ShiftLeft', 16);
        await ev('window.__harness.step(240)');
        const v = await ev('Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y))');
        await ev(`window.DevScene.pointerAt(${P.x + 6000}, ${P.y + 300})`);
        const r = await variant('ruch', 'yamato', label, tune, false, 0.3, true);
        r.predkosc = v;
        rows.push(r);
        await keyEv('keyUp', 'w', 'KeyW', 87);
        await keyEv('keyUp', 'Shift', 'ShiftLeft', 16);
        await ev('(() => { window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()');
      }
      report.sceny.ruch = { rows, pipeline: await pipesSince(k1) };
      console.log('ruch pipeline', JSON.stringify(report.sceny.ruch.pipeline));
    }
    if (sceny.includes('bronie3d')) {
      await ev(`(() => { window.DevScene.teleport(${P.x}, ${P.y}, 0); window.ship.angVel = 0; window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
      await ev(`window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300})`);
      await ev('window.setVisualMode(false, true)');
      await ev('window.__harness.step(60)');
      const k1 = await frameK();
      const rows = [await variant('bronie3d', 'yamato', 'gaz', {})];
      report.sceny.bronie3d = { rows, pipeline: await pipesSince(k1) };
      console.log('bronie3d pipeline', JSON.stringify(report.sceny.bronie3d.pipeline));
      await ev('window.setVisualMode(false, false)');
    }
    report.pipelineSceny = await pipesSince(k0);
    await ev('(() => { const h = window.__harness; h.hold(false); h.clock.mode = "real"; return true; })()');
  }

  if (tryby.includes('dok')) {
    // Misja 1 (faza ram): suchy dok piratów, Atlas przy bramie taranowej G-W, armata w stronę doku.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ram` });
    await waitFor(cdp, '!!window.__harness', 60000, 100);
    await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
    await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
    await sleep(1200);
    await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
    await sleep(700);
    await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'ram' && !!window.StoryGame.site?.station", 300000, 400)) throw new Error('faza ram nie ruszyła');
    await waitFor(cdp, '!!window.__explosions && !!window.DevScene?.mountMain', 30000, 200);
    await sleep(2500);
    await ev(INSTRUMENT);
    const g = await ev(`(() => {
      window.setFogOfWar?.(false);
      const S = window.StoryGame, d = S.site.dock, l = d.layout;
      const gate = l.chunkById.get('G-W') || l.chunks.find((c) => c.kind === 'gate');
      const gx = (gate.box.x0 + gate.box.x1) / 2, gz = (gate.box.z0 + gate.box.z1) / 2;
      const g0 = d.toGame(gx, gz), p = d.toGame(gx - 1600, gz);
      S.deps.placePlayer(p.x, p.y, Math.atan2(g0.y - p.y, g0.x - p.x)); window.ship.vel.x = 0; window.ship.vel.y = 0;
      window.DevScene.mountMissile(null); window.DevScene.mountMain('armata_mk1');
      if (window.fireControl) window.fireControl.posture = 'hold';
      return { gx: g0.x, gy: g0.y, px: p.x, py: p.y };
    })()`);
    await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
    await ev('window.__harness.step(30)');
    // Cel ćwiczebny za bramą (wieże na auto celują przez bramę w dok).
    report.dokCel = await target(g.gx + (g.gx - g.px) * 0.6, g.gy + (g.gy - g.py) * 0.6, 'destroyer');
    await ev(`window.DevScene.pointerAt(${g.gx}, ${g.gy})`);
    await ev(`(() => { if (window.fireControl) window.fireControl.posture = 'free'; return true; })()`);
    const k1 = await frameK();
    const rows = [];
    rows.push(await variant('dok', 'armata', 'gaz', {}, false, 0.45));
    rows.push(await variant('dok', 'armata', 'bezPrzeszkod', { obstacles: false }, false, 0.45));
    report.dok = { g, rows, pipeline: await pipesSince(k1) };
    console.log('dok pipeline', JSON.stringify(report.dok.pipeline));
    await ev('(() => { const h = window.__harness; h.hold(false); h.clock.mode = "real"; return true; })()');
  }

  if (tryby.includes('strzelnica')) {
    // Kontrolowany koszt: Atlas (6 Yamato, armaty na gniazdach main) strzela ciągle do 4 celów ćwiczebnych, salwa Yamato
    // na początku każdego odcinka; odcinki po 6 s z gazem wylotu i bez NAPRZEMIENNIE (ABBA ×2).
    const P0 = tryby.includes('sceny') ? await ev('({ x: window.ship.pos.x, y: window.ship.pos.y })') : await startFree();
    await ev('(() => { const h = window.__harness; h.hold(false); h.clock.mode = "real"; return true; })()');
    const k0 = await frameK();
    const sx = P0.x + 500000, sy = P0.y + 300000;
    await ev(`(() => { window.DevScene.teleport(${sx}, ${sy}, 0); window.ship.vel.x = 0; window.ship.vel.y = 0;
      window.DevScene.mountMissile(null); window.DevScene.mountSpecial('special_yamato_cannon'); window.DevScene.mountMain('armata_mk1');
      if (window.fireControl) window.fireControl.posture = 'free'; return true; })()`);
    for (const [dx, dy] of [[2600, 300], [2400, -900], [2500, 1200], [-2500, 600]]) {
      await ev(`(() => { const r = window.spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: { x: ${sx + dx}, y: ${sy + dy} }, pos: { x: ${sx + dx}, y: ${sy + dy} }, spawnAngle: 1.5 });
        const e = Array.isArray(r) ? r[0] : r; if (e) { e.ai = () => {}; e.hp = e.maxHp = 1e9; if (e.shield) { e.shield.max = 0; e.shield.val = 0; } e.__fogVisible = true; } return !!e; })()`);
    }
    await camAt(sx + 600, sy, ZOOM);
    await ev(`window.DevScene.pointerAt(${sx + 2600}, ${sy + 300})`);
    await sleep(6000);
    const seg = (on) => ev(`(async () => {
      const X = window.__explosions, C = window.Core3D;
      X.tune.muzzleGas = ${on}; window.refillPlayerAmmo?.();
      if (window.ship.hull) window.ship.hull.val = window.ship.hull.max;
      window.DevScene.fireSpecial();
      const s0 = { ...X.stats };
      const dts = [], gpu = [], comp = []; let last = performance.now(); const t0 = last; let n = 0, mz = 0, dom = 0, cpu = 0;
      while (performance.now() - t0 < 6000) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now(); dts.push(now - last); last = now; n++;
        if (C.gpuFrameMs > 0) gpu.push(C.gpuFrameMs); if (C.gpuComputeMs > 0) comp.push(C.gpuComputeMs);
        mz = Math.max(mz, X.stats.mzDomains); dom = Math.max(dom, X.grid.stats.active); cpu += X.stats.cpuMs;
        if (n % 120 === 0) window.DevScene.fireSpecial();
      }
      const d = (k) => (X.stats[k] || 0) - (s0[k] || 0);
      dts.sort((a, b) => a - b); gpu.sort((a, b) => a - b); comp.sort((a, b) => a - b);
      const q = (a, p) => a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(3) : null;
      return { gazWylotu: ${on}, klatki: n, sredniaMs: +(dts.reduce((a, b) => a + b, 0) / n).toFixed(3), p95: q(dts, 0.95), najgorszaMs: +dts[dts.length - 1].toFixed(1),
        gpuMed: q(gpu, 0.5), gpuP95: q(gpu, 0.95), computeMed: q(comp, 0.5), cpuKrokuSr: +(cpu / n).toFixed(3), mzMax: mz, domenyMax: dom,
        wystrzaly: d('mzShots'), zGazem: d('mzGas'), bezDomeny: d('mzNoSlot'), zaMale: d('mzSmall') };
    })()`);
    const L = [];
    for (const on of [true, false, false, true, true, false, false, true]) { const r = await seg(on); L.push(r); console.log('strzelnica', JSON.stringify(r)); }
    const sum = (on) => { const A = L.filter((r) => r.gazWylotu === on); const a = (k) => +(A.reduce((p, r) => p + (r[k] || 0), 0) / A.length).toFixed(3);
      return { sredniaMs: a('sredniaMs'), p95: a('p95'), najgorszaMs: Math.max(...A.map((r) => r.najgorszaMs)), gpuMed: a('gpuMed'), gpuP95: a('gpuP95'), computeMed: a('computeMed'),
        cpuKrokuSr: a('cpuKrokuSr'), mzMax: Math.max(...A.map((r) => r.mzMax)), wystrzaly: A.reduce((p, r) => p + r.wystrzaly, 0), zGazem: A.reduce((p, r) => p + r.zGazem, 0),
        bezDomeny: A.reduce((p, r) => p + r.bezDomeny, 0) }; };
    report.strzelnica = { odcinki: L, z: sum(true), bez: sum(false), pipeline: await pipesSince(k0) };
    console.log('STRZELNICA z gazem', JSON.stringify(report.strzelnica.z));
    console.log('STRZELNICA bez gazu', JSON.stringify(report.strzelnica.bez));
    console.log('strzelnica pipeline', JSON.stringify(report.strzelnica.pipeline));
    await ev('(() => { window.__explosions.tune.muzzleGas = true; return true; })()');
  }

  if (tryby.includes('bitwa')) {
    if (!tryby.includes('sceny')) {
      const P0 = await startFree();
      report.miejsce = P0;
    }
    await ev('(() => { const h = window.__harness; h.hold(false); h.clock.mode = "real"; return true; })()');
    const k0 = await frameK();
    const P = await ev('({ x: window.ship.pos.x, y: window.ship.pos.y })');
    const [NF, ND, NB, NS] = SKLAD;
    const bx = P.x - 200000, by = P.y - 150000;
    await ev(`(() => { window.DevScene.teleport(${bx}, ${by}, 0); window.DevScene.syncCamera();
      window.DevScene.mountMissile(null); window.DevScene.mountSpecial('special_yamato_cannon'); window.DevScene.mountMain('armata_mk1');
      if (window.fireControl) window.fireControl.posture = 'free'; return true; })()`);
    await sleep(1500);
    const sp = await ev(`(() => {
      const s = window.ship, a = 0, c = Math.cos(a), n = Math.sin(a);
      const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
      const out = { piraci: 0, tn: 0 };
      const put = (key, mode, pos, ang) => { const r = window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: ang });
        const k = Array.isArray(r) ? r.length : (r ? 1 : 0); if (mode === 'pirate') out.piraci += k; else out.tn += k; };
      const block = (key, mode, k, fwd0, rowGap, spacing, perRow, dir, ang) => {
        for (let i = 0; i < k; i++) { const row = Math.floor(i / perRow), inRow = Math.min(perRow, k - row * perRow), j = i - row * perRow;
          put(key, mode, at(fwd0 + dir * row * rowGap, (j - (inRow - 1) / 2) * spacing), ang); } };
      block('frigate_pd', 'pirate', ${NF}, 5000, 700, 650, 25, 1, a + Math.PI);
      block('destroyer', 'pirate', ${ND}, 6600, 900, 900, 20, 1, a + Math.PI);
      block('pirate_battleship', 'pirate', ${NB}, 8600, 1500, 1500, 10, 1, a + Math.PI);
      block('pirate_supercapital', 'pirate', ${NS}, 11500, 3500, 4000, 5, 1, a + Math.PI);
      block('frigate_laser', 'friendly', ${NF}, -1500, 700, 650, 25, -1, a);
      block('destroyer', 'friendly', ${ND}, -3100, 900, 900, 20, -1, a);
      block('battleship', 'friendly', ${NB}, -5100, 1500, 1500, 10, -1, a);
      block('supercapital', 'friendly', ${NS}, -8000, 3500, 4000, 5, -1, a);
      window.__godTimer2 = setInterval(() => { const s2 = window.ship; if (s2?.hull) s2.hull.val = s2.hull.max; if (s2?.shield) s2.shield.val = s2.shield.max; }, 100);
      return out;
    })()`);
    console.log('bitwa spawn', JSON.stringify(sp));
    // kamera: środek walki (piraci nadlatują ku graczowi), zoom bitwy
    const follow = `(() => { const cam = window.camera; if (cam.mode !== 'rts' && cam.enterRtsMode) cam.enterRtsMode();
      let sx = 0, sy = 0, n = 0; for (const q of window.npcs) if (q && !q.dead && !q.fighter) { sx += q.x; sy += q.y; n++; }
      const s = window.ship; const x = n ? (sx / n) * 0.5 + s.pos.x * 0.5 : s.pos.x, y = n ? (sy / n) * 0.5 + s.pos.y * 0.5 : s.pos.y;
      cam.x = cam.targetX = x; cam.y = cam.targetY = y; cam.manualZoom = true; cam.zoom = cam.targetZoom = cam.zoomBase = ${ZOOM_BITWY}; cam.transition = null;
      document.getElementById('cockpit-ui-host')?.classList.add('hidden'); return true; })()`;
    await ev(follow);
    await sleep(Math.max(0, BITWA) * 1000);
    const measure = (label, on) => ev(`(async () => {
      const X = window.__explosions, C = window.Core3D;
      ${follow};
      X.tune.muzzleGas = ${on};
      const s0 = { ...X.stats }, w0 = window.WeaponFx.stats.gasMuzzles, mus0 = window.WeaponFx.stats.muzzles;
      X.stats.mzMax = 0;
      const dts = [], gpu = []; let last = performance.now(); const t0 = last; let n = 0, maxDom = 0, mzMax = 0, lastKill = t0, lastY = t0 - 6000, killed = 0, cpu = 0;
      while (performance.now() - t0 < 6000) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now(); dts.push(now - last); last = now; n++;
        if (C.gpuFrameMs > 0) gpu.push(C.gpuFrameMs);
        maxDom = Math.max(maxDom, X.grid.stats.active); mzMax = Math.max(mzMax, X.stats.mzDomains); cpu += X.stats.cpuMs;
        if (${ZGONY} > 0 && now - lastKill > 1000) {
          lastKill = now;
          const v = C.fx?.view; const inView = (q) => !v || (q.x > v.x0 && q.x < v.x1 && q.y > v.y0 && q.y < v.y1);
          const cand = window.npcs.filter((q) => q && !q.dead && q.beamHull && !q.fighter && inView(q));
          for (let i = 0; i < ${ZGONY} && cand.length; i++) { const q = cand.splice(Math.floor(Math.random() * cand.length), 1)[0];
            window.applyDamageToNPC(q, (q.hp || 1) + 1e7, 'default', { bypassShield: true }); killed++; }
        }
        if (now - lastY > 5500) { lastY = now; window.DevScene.fireSpecial(); }
      }
      const s1 = X.stats, d = (k) => (s1[k] || 0) - (s0[k] || 0);
      dts.sort((a, b) => a - b); gpu.sort((a, b) => a - b);
      const q = (a, p) => a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(3) : null;
      return { label: '${label}', gazWylotu: ${on}, klatki: n, sredniaMs: +(dts.reduce((a, b) => a + b, 0) / n).toFixed(3), p95: q(dts, 0.95), najgorszaMs: +dts[dts.length - 1].toFixed(1),
        gpuMed: q(gpu, 0.5), gpuP95: q(gpu, 0.95), cpuKrokuSr: +(cpu / n).toFixed(3), maxDomen: maxDom, mzMax,
        wystrzaly: { razem: d('mzShots'), gaz: d('mzGas'), bezDomeny: d('mzNoSlot'), zaMale: d('mzSmall'), pozaKadrem: d('mzOff'), przejete: d('mzTaken'),
          wylotyPelne: window.WeaponFx.stats.muzzles - mus0, wylotyZGazem: window.WeaponFx.stats.gasMuzzles - w0 },
        wybuchy: { razem: d('spawned'), gaz: d('gas'), czastki: d('particles'), noSlot: d('noSlot'), recl: d('reclaimed'), merged: d('merged'), inh: d('inherited') },
        zgony: killed, npc: window.npcs.filter((x) => !x.dead).length };
    })()`);
    const SEG = [true, false, false, true, true, false, false, true];
    const odc = [];
    for (let i = 0; i < SEG.length; i++) {
      const r = await measure(`odcinek ${i}`, SEG[i]);
      odc.push(r); console.log('odcinek', JSON.stringify(r));
    }
    await ev('(() => { window.__explosions.tune.muzzleGas = true; return true; })()');
    const sum = (on) => {
      const L = odc.filter((r) => r.gazWylotu === on);
      const a = (f) => +(L.reduce((s, r) => s + f(r), 0) / Math.max(1, L.length)).toFixed(3);
      const t = (f) => L.reduce((s, r) => s + f(r), 0);
      return { n: L.length, sredniaMs: a((r) => r.sredniaMs), p95: a((r) => r.p95), najgorszaMs: Math.max(...L.map((r) => r.najgorszaMs)),
        gpuMed: a((r) => r.gpuMed || 0), cpuKrokuSr: a((r) => r.cpuKrokuSr), maxDomen: Math.max(...L.map((r) => r.maxDomen)), mzMax: Math.max(...L.map((r) => r.mzMax)),
        wystrzalyGaz: t((r) => r.wystrzaly.gaz), wystrzalyBezDomeny: t((r) => r.wystrzaly.bezDomeny), wystrzalyZaMale: t((r) => r.wystrzaly.zaMale),
        przejete: t((r) => r.wystrzaly.przejete), wybuchy: t((r) => r.wybuchy.razem), wybuchyGaz: t((r) => r.wybuchy.gaz),
        wybuchyCzastki: t((r) => r.wybuchy.czastki), wybuchyNoSlot: t((r) => r.wybuchy.noSlot), wybuchyRecl: t((r) => r.wybuchy.recl) };
    };
    report.bitwa = { spawn: sp, odcinki: odc, z: sum(true), bez: sum(false), pipeline: await pipesSince(k0) };
    console.log('BITWA z gazem wylotu', JSON.stringify(report.bitwa.z));
    console.log('BITWA bez gazu wylotu', JSON.stringify(report.bitwa.bez));
    console.log('bitwa pipeline', JSON.stringify(report.bitwa.pipeline));
  }
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  console.error(err);
  report.logi = logs.all().slice(-60);
} finally {
  try { report.tslUuid = await ev('(() => { const u = window.Core3D?.tslUuid; return u ? { kolizje: u.kolizje } : null; })()'); console.log('tslUuid', JSON.stringify(report.tslUuid)); } catch { /* strona padła */ }
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference|Unable to decode audio|AudioSys/.test(l)).slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.slice(0, 20).join('\n'));
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
