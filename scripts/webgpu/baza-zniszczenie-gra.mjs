// Budowle bazy piratów (misja 1) do zera W GRZE — zwykłą bronią i taranem (zgłoszenie użytkownika 2026-10-14: „habitat
// staje na ~32%, taran też nie idzie”). Vite + headless Chrome z WebGPU, skok dev ?story=shipyard.
//
//   node scripts/webgpu/baza-zniszczenie-gra.mjs [--tryb ostrzal,taran,magazyn] [--out .tmp/baza-zniszczenie]
//     [--bron special_yamato_cannon] [--strzaly 900] [--rozmiar 1600x900]
//
// ostrzal — Atlas 3,5 km od habitatu, strzały rdzeniem gry (fireWeaponCore) w środek habitatu z czterech stron po
//   kolei (pociski trafiają w bryły / ciała kawałków jak w grze); co 2 s: punkty, kawałki pęknięte, czy jest jeszcze
//   w co trafić. Koniec: habitat zniszczony albo zastój (punkty bez zmian przez 12 s ognia).
// taran — Atlas rozpędzony W + Shift (dopalacz) w ścianę bębna od południa, kilka najazdów; punkty habitatu, węzły
//   kawałków bębna i rdzenia przed / po.
// magazyn — jak ostrzał, ale magazyn (2 kawałki, 4 progi).
// szyja — scenariusz szyi habitatu (src/game/story/pirateBaseNeck.js, audyt destruktora 2026-10-14 R8): Atlas z prawej
//   strony ekranu (kurs w lewo) w szarży F + W w szyb habitatu → zerwanie szyi, głowa spada w prawo na dysk mieszkalny;
//   kadry zerwania / spadku / lądowania, położenie głowy, punkty habitatu, pipeline'y synchroniczne w klatkach gry.
//   --ostrzal 1 — potem OSTRZAŁ przewróconej wieży (bryła 3D: trafienia w pasie broni, src/game/beamBand3D.js) bronią
//   gry (fireWeaponCore: Yamato, armata, laser pulsacyjny, rakiety, Mjolnir — `--bronie id,id`) w przekrój wieży
//   z płaszczyzną gry i w dysk mieszkalny (pod pasem — pociski mijają, kula fali Supernowej sięga): węzły wieży
//   i dysku przed / po, stemple ran 3D (SolidWounds), odłamy, czas fizyki i klatek, pipeline'y synchroniczne ostrzału.
// Raport: <out>/raport.json, kadry PNG.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/baza-zniszczenie');
mkdirSync(out, { recursive: true });
const tryby = String(args.tryb || 'ostrzal,taran').split(',').map((s) => s.trim()).filter(Boolean);
const bron = String(args.bron || 'special_yamato_cannon');
const maxShots = Number(args.strzaly || 900);

const { server, base } = await startVite(Number(args.port || 5377));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { tryby: {}, bledy: [] };

// Pipeline'y renderu tworzone SYNCHRONICZNIE (nikt ich nie rozgrzał) — ma być 0 w klatkach scenariusza.
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, t: performance.now(), nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

// Start ponawiany: zapis pliku przez inną sesję przeładowuje stronę w Vite (pełny reload w trakcie ładowania).
async function startStory(phase) {
  for (let i = 0; ; i++) {
    try { return await startStoryOnce(phase); } catch (err) {
      if (i >= 2) throw err;
      console.log(`start fazy ${phase} — ponowienie (${err.message})`);
    }
  }
}
async function startStoryOnce(phase) {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${phase}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${phase}' && !!window.StoryGame.site?.station`, 90000, 400)) throw new Error(`faza ${phase} nie ruszyła`);
}

// Atlas nieśmiertelny na czas pomiaru (piraci i drony strzelają), wieże na auto wstrzymane.
const GUARD = `(() => {
  if (window.__guard) return true;
  window.__guard = setInterval(() => {
    const s = window.ship;
    if (!s) return;
    if (s.hull) s.hull.val = s.hull.max;
    if (s.shield) s.shield.val = s.shield.max;
    if (window.fireControl) window.fireControl.posture = 'hold';
  }, 100);
  return true;
})()`;

const placeHub = (x, z, heading, speed = 0) => ev(`(() => {
  const S = window.StoryGame, d = S.site.dock, ship = window.ship;
  const p = d.toGame(${x}, ${z});
  const a = d.headingToGame(${heading});
  S.deps.placePlayer(p.x, p.y, a);
  ship.vel.x = Math.cos(a) * ${speed}; ship.vel.y = Math.sin(a) * ${speed};
  return true;
})()`);

const camHub = (x, z, zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera;
  const p = site.dock.toGame(${x}, ${z});
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);
const camShip = (zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode === 'rts' && typeof c.exitRtsMode === 'function') c.exitRtsMode();
  c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  return true;
})()`);

// stan budowli: punkty, kawałki (statyka / ciało / pęknięty / stracony), węzły ciał
const structState = (key) => ev(`(() => {
  const S = window.StoryGame, site = S.site, st = site.structures['${key}'], l = site.dock.layout;
  const W = window.WorldBodies, ws = st && st._worldSite ? W.site(st._worldSite) : null;
  const gone = st && st._dockGone ? [...st._dockGone] : [];
  const chunks = l.structures['${key}'].map((id) => {
    const c = l.chunkById.get(id);
    const p = ws ? ws.pieces.find((q) => q.id === id) : null;
    return { id, kind: c.kind, duch: !!c.ghost, statykaBrak: gone.includes(id), stan: p ? p.state : '-', zywe: p ? (p.alive ?? 0) : 0, wezly: p ? p.baseNodes : 0 };
  });
  return { hp: Math.round(st.hp), maxHp: st.maxHp, proc: +(100 * st.hp / st.maxHp).toFixed(1), zniszczony: !!st._destroyed3D || !(st.hp > 0), chunks };
})()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
}

// Ostrzał budowli `key` bronią gry: lufa 1,6 km od środka budowli, cztery kierunki na zmianę, cel = środek obwiedni
// kawałków budowli (jeszcze stojących — jak gracz, który celuje w to, co widzi).
async function ostrzal(key) {
  await startStory('shipyard');
  await sleep(2000);
  await ev(GUARD);
  const c = await ev(`(() => {
    const l = window.StoryGame.site.dock.layout;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const id of l.structures['${key}']) { const c = l.chunkById.get(id); if (c.ghost) continue; x0 = Math.min(x0, c.box.x0); x1 = Math.max(x1, c.box.x1); z0 = Math.min(z0, c.box.z0); z1 = Math.max(z1, c.box.z1); }
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.max(x1 - x0, z1 - z0) / 2 };
  })()`);
  await placeHub(c.x, c.z + 3500, -Math.PI / 2, 0);
  await waitFor(cdp, '(window.WorldBodies?.stats?.live || 0) > 0', 30000, 200);
  await sleep(1500);
  await camHub(c.x, c.z, key === 'piers' ? 0.05 : 0.14);
  await shot(`${key}-00-start`);
  const przebieg = [];
  const t0 = Date.now();
  let shots = 0;
  let lastHp = Infinity;
  let stallMs = 0;
  let lastChange = Date.now();
  przebieg.push({ s: 0, strzaly: 0, ...(await structState(key)) });
  while (shots < maxShots) {
    // seria 20 strzałów w 2 s (ten sam rdzeń strzału co gra), kierunki na zmianę; cel — środek stojących kawałków
    shots += await ev(`new Promise((res) => {
      const S = window.StoryGame, d = S.site.dock, l = d.layout, st = S.site.structures['${key}'];
      const gone = st._dockGone || new Set();
      const W = window.WorldBodies, ws = st._worldSite ? W.site(st._worldSite) : null;
      const stoi = l.structures['${key}'].filter((id) => {
        const c = l.chunkById.get(id);
        if (c.ghost) return false;
        const p = ws ? ws.pieces.find((q) => q.id === id) : null;
        return !(p && p.state === 'lost') && (!gone.has(id) || (p && p.state === 'live'));
      });
      const ids = stoi.length ? stoi : l.structures['${key}'];
      let k = 0;
      const tick = () => {
        const c = l.chunkById.get(ids[k % ids.length]);
        const tx = (c.box.x0 + c.box.x1) / 2, tz = (c.box.z0 + c.box.z1) / 2;
        const a = (k % 4) * Math.PI / 2 + 0.3;
        const mx = tx + Math.cos(a) * 1600, mz = tz + Math.sin(a) * 1600;
        const p = d.toGame(mx, mz), t = d.toGame(tx, tz);
        const dx = t.x - p.x, dy = t.y - p.y, len = Math.hypot(dx, dy) || 1;
        try { window.fireWeaponCore(window.ship, null, '${bron}', { pos: { x: p.x, y: p.y }, dir: { x: dx / len, y: dy / len }, baseVel: { x: 0, y: 0 } }); } catch (e) { console.error('[baza] strzał', e); }
        if (++k >= 20) { clearInterval(h); res(k); }
      };
      const h = setInterval(tick, 100);
      tick();
    })`, 30000);
    await sleep(300);
    const s = await structState(key);
    przebieg.push({ s: +((Date.now() - t0) / 1000).toFixed(1), strzaly: shots, hp: s.hp, proc: s.proc, zniszczony: s.zniszczony,
      kawalki: s.chunks.filter((q) => !q.duch).map((q) => `${q.id}:${q.stan}${q.statykaBrak ? '*' : ''}`).join(' ') });
    console.log(key, `strzały ${shots}`.padEnd(14), `${s.proc}%`.padEnd(8), przebieg[przebieg.length - 1].kawalki);
    if (s.zniszczony) break;
    if (s.hp < lastHp - 0.5) { lastHp = s.hp; lastChange = Date.now(); }
    stallMs = Date.now() - lastChange;
    if (stallMs > 12000) break;
  }
  const koniec = await structState(key);
  await shot(`${key}-01-koniec`);
  await sleep(4000);
  await shot(`${key}-02-po-4s`);
  report.tryby[`ostrzal-${key}`] = { bron, strzaly: shots, zastoj: !koniec.zniszczony && stallMs > 12000, koniec, przebieg };
  console.log(key, koniec.zniszczony ? 'ZNISZCZONY' : `ZASTÓJ na ${koniec.proc}%`, 'po', shots, 'strzałach');
}

const key = (code, k, vk) => ({ key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
const KEY_W = key('KeyW', 'w', 87), KEY_SHIFT = key('ShiftLeft', 'Shift', 16), KEY_S = key('KeyS', 's', 83);

// Taran: Atlas 2,6 km na południe od ściany bębna, dziobem ku habitatowi, rozpęd 900 j/s + W + Shift (dopalacz),
// kilka najazdów (cofnięcie i znów), ostatnie najazdy przez środek (rdzeń).
async function taran() {
  await startStory('shipyard');
  await sleep(2000);
  await ev(GUARD);
  const L = await ev(`(() => { const H = window.StoryGame.site.dock.layout.habitat; return { drumR: H.drumR }; })()`);
  const przebieg = [];
  przebieg.push({ najazd: 0, ...(await structState('habitat')) });
  console.log('taran start', JSON.stringify(przebieg[0].chunks.filter((q) => !q.duch)));
  const najazdy = Number(args.najazdy || 6);
  for (let n = 1; n <= najazdy; n++) {
    const off = [0, 300, -300, 0, 500, -500][(n - 1) % 6];
    await placeHub(off, L.drumR + 2600, -Math.PI / 2, 900);
    await camShip(0.14);
    await sleep(300);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_SHIFT });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_W, modifiers: 8 });
    await sleep(Number(args.trzymaj || 6000));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_W });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_SHIFT });
    await shot(`taran-${String(n).padStart(2, '0')}`);
    const s = await structState('habitat');
    const atlas = await ev(`(() => { const d = window.StoryGame.site.dock, h = d.toHub(window.ship.pos.x, window.ship.pos.y); return { hub: [Math.round(h.x), Math.round(h.z)], v: Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y)) }; })()`);
    przebieg.push({ najazd: n, atlas, ...s });
    console.log(`taran ${n}`, `${s.proc}%`, JSON.stringify(atlas), s.chunks.filter((q) => !q.duch).map((q) => `${q.id}:${q.stan}:${q.zywe}/${q.wezly}`).join(' '));
    if (s.zniszczony) break;
  }
  report.tryby.taran = { przebieg };
}

const KEY_F = { code: 'KeyF', key: 'f', windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 70 };
async function szyja() {
  await startStory('shipyard');
  await sleep(2000);
  await ev(GUARD);
  // czasy kroku fizyki ciał (HullBodies.step) i klatek (rAF) w oknie próbki — zerowane przy odczycie
  await ev(`(() => {
    if (window.__physRec) return true;
    const R = window.__physRec = { n: 0, sum: 0, max: 0, fn: 0, fsum: 0, fmax: 0, fslow: 0, last: 0 };
    const HB = window.HullBodies, step = HB.step;
    HB.step = function (...a) { const t = performance.now(); const r = step.apply(this, a); const ms = performance.now() - t; R.n++; R.sum += ms; if (ms > R.max) R.max = ms; return r; };
    const raf = (t) => { if (R.last) { const d = t - R.last; R.fn++; R.fsum += d; if (d > R.fmax) R.fmax = d; if (d > 50) R.fslow++; } R.last = t; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    return true;
  })()`);
  // z prawej strony ekranu (gra: +x), kurs w lewo (π), rozpęd 1500 j/s, szarża F + W
  await ev(`(() => {
    const S = window.StoryGame, d = S.site.dock, hc = d.habitat, H = d.layout.habitat;
    S.deps.placePlayer(hc.x + H.drumR + 2400, hc.y + 40, Math.PI);
    window.ship.vel.x = -1500; window.ship.vel.y = 0;
    return true;
  })()`);
  const t0 = await ev('performance.now()');
  // kamera statku (w RTS trzymane W przesuwa kamerę zamiast ciągu), oddalona; mgła wojny wyłączona na czas próby
  await ev(`(() => { window.setFogOfWar?.(false); for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none'; return true; })()`);
  await camShip(Number(args.zoom || 0.2));
  // --kamera tactical|top|orbit|cinema — kamera 3D przez cały scenariusz (Game3D: taktyczna 3/4 pokazuje przechył z boku)
  if (args.kamera) await ev(`(() => { window.Game3D?.setCamera(${JSON.stringify(String(args.kamera))}); return window.Game3D?.mode; })()`);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_W });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_F });
  await sleep(80);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_F });
  const przebieg = [];
  const kadry = new Set();
  // kadry: zerwanie, przechył ~25° i ~55°, uderzenie boku, pęknięcie przegubu, 1 s i 3 s po uderzeniu
  const kadr = async (tag) => { if (!kadry.has(tag)) { kadry.add(tag); await shot(`szyja-${tag}`); } };
  let impactAt = -1, landedAt = -1;
  for (let i = 0; i < Number(args.probki || 120); i++) {
    await sleep(250);
    const s = await ev(`(() => {
      const S = window.StoryGame, d = S.site.dock, hc = d.habitat;
      const hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat');
      const n = hs && hs.neck, tw = n && n.tower, b = tw && tw.beamHull && tw.beamHull.body;
      const st = S.site.structures.habitat;
      const tilt = b ? Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (b.quat.x * b.quat.x + b.quat.y * b.quat.y)))) * 57.2958 : 0;
      const R = window.__physRec;
      const fiz = R ? [+(R.sum / Math.max(1, R.n)).toFixed(1), +R.max.toFixed(1), R.n] : null;
      const kl = R ? [+(R.fsum / Math.max(1, R.fn)).toFixed(1), +R.fmax.toFixed(1)] : null;
      if (R) { R.n = 0; R.sum = 0; R.max = 0; R.fn = 0; R.fsum = 0; R.fmax = 0; }
      // sektory dysku (bryły 3D): ile żywych / statycznych, kolejka budowy ciał świata, skóra wieży
      const ds = hs ? hs.pieces.filter((p) => p.kind === 'disc') : [];
      const dysk = ds.filter((p) => p.state === 'live').length + '/' + ds.length + (ds.some((p) => p.queued) ? 'q' : '');
      const ht = hs ? hs.pieces.find((p) => p.id === 'H-T') : null;
      return { faza: n ? n.phase : '-', proc: +(100 * st.hp / st.maxHp).toFixed(1), dysk, kolejka: window.WorldBodies._queue.length,
        skoraWiezy: ht ? (ht.__skin ? 'S' : ht.__skinJob ? 'j' : '-') : '?',
        atlas: [Math.round(window.ship.pos.x - hc.x), Math.round(window.ship.pos.y - hc.y), Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y))],
        wieza: b ? [Math.round(b.pos.x - hc.x), Math.round(-b.pos.y - hc.y), Math.round(b.pos.z), Math.round(tilt), b.activeNodes] : null,
        uderzenie: n ? +n.impactT.toFixed(2) : -1, przegub: n ? +n.hingeBrokeT.toFixed(2) : -1, zamrozona: n ? n.frozen || 0 : 0,
        odlamy: (window.wrecks || []).filter((w) => w.solid3D && !w.dead).length,
        fizykaMs: fiz, klatkaMs: kl };
    })()`);
    przebieg.push({ t: +(i * 0.25 + 0.25).toFixed(2), ...s });
    console.log('szyja', JSON.stringify(przebieg[przebieg.length - 1]));
    if (s.faza === 'toppling' && !kadry.has('zerwanie')) await kadr('zerwanie');
    if (args.seria && s.faza !== 'attached' && i % 4 === 0) await shot(`szyja-seria-${String(i).padStart(3, '0')}`);
    if (s.wieza && s.wieza[3] >= 25) await kadr('przechyl-25');
    if (s.wieza && s.wieza[3] >= 55) await kadr('przechyl-55');
    if (s.uderzenie >= 0 && impactAt < 0) { impactAt = i; await kadr('uderzenie'); }
    if (s.przegub >= 0) await kadr('przegub');
    if (impactAt >= 0 && i - impactAt >= 4) await kadr('po-1s');
    if (impactAt >= 0 && i - impactAt >= 12) await kadr('po-3s');
    if (s.faza === 'landed' && landedAt < 0) { landedAt = i; await kadr('osiadla'); }
    if (landedAt >= 0 && i - landedAt >= 4 && kadry.has('po-3s')) break;
  }
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_W });
  await shot('szyja-koniec');
  // skóry ciał świata (wieża i jej odłamy, dysk) i kadry z kamer 3D (K — kolejne widoki)
  const skory = await ev(`(() => {
    const hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat');
    const n = hs && hs.neck;
    const disc = hs ? hs.pieces.filter((p) => p.kind === 'disc').map((p) => p.id + ':' + p.state + (p.touched ? '*' : '') + (p.__skin ? 'S' : '')) : [];
    const tw = n && n.tower;
    return { stats: window.__worldSkinStats, wieza: tw ? { skora: !!(tw.beamHull && tw.beamHull.world && tw.beamHull.world.__skin), z: tw.z } : null, disc };
  })()`);
  console.log('skóry', JSON.stringify(skory));
  const KEY_K = { code: 'KeyK', key: 'k', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 };
  for (let k = 1; k <= Number(args.kamery ?? 2); k++) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEY_K });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEY_K });
    await sleep(1500);
    await shot(`szyja-kamera3d-${k}`);
  }
  report.skory = skory;
  const pipes = await ev(`(() => { const p = (window.__pipeRec ? window.__pipeRec.pipes : []).filter((x) => x.t >= ${t0}); const sync = p.filter((x) => x.sync); return { wszystkie: p.length, sync: sync.length, lista: sync.slice(0, 30).map((x) => x.nazwa) }; })()`);
  console.log('pipeline w scenariuszu', JSON.stringify(pipes));
  report.tryby.szyja = { przebieg, pipeline: pipes };
  if (args.ostrzal) await ostrzalWiezy();
}

// Ostrzał przewróconej wieży habitatu i dysku (bryły 3D — pas broni, src/game/beamBand3D.js). Atlas staje 3–6 km od
// wieży w wolnym miejscu (poza kawałkami bazy i okrętami; bańka ciał świata trzyma dysk jako ciała), dziobem na wieżę,
// kamera z góry nad wieżą. Serie z lufy 1,8 km od celu w poprzek osi wieży (strony na zmianę), cele = punkty przekroju
// wieży z pasem (rzut węzłów |z| ≤ pas + ½ komórki) od nasady do głowy; potem Hexlance z gniazd Atlasa, dysk poza bębnem
// (pod pasem — pociski mijają) i Supernowa w dysk (kula fali sięga w dół).
async function ostrzalWiezy() {
  // kamera klasyczna (z góry, ortho) po kadrach z kamer 3D (K)
  await ev(`(() => { window.Game3D?.setCamera('classic'); return window.Game3D?.mode; })()`);
  await sleep(600);
  // licznik trafień brył (hak HullBodies.onImpact — kratery i rzazy z wynikiem `solid`)
  await ev(`(() => {
    const HB = window.HullBodies;
    if (HB.__solidHitRec) return true;
    const R = HB.__solidHitRec = { kratery: 0, wezly: 0 };
    const prev = HB.onImpact;
    HB.onImpact = function (e, r) { if (r && r.solid) { R.kratery++; R.wezly += r.killed || 0; } return prev ? prev.call(this, e, r) : undefined; };
    return true;
  })()`);
  // stan wieży (węzły, w pasie), dysku (żywe sektory, węzły), odłamów brył, ran 3D i trafień
  const stan = () => ev(`(() => {
    const HB = window.HullBodies, hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat');
    const tw = hs && hs.neck && hs.neck.tower, hull = tw && tw.beamHull, b = hull && hull.entity === tw ? hull.body : null;
    const out = { wieza: null, dysk: { zywe: 0, wszystkie: 0, wezly: 0 }, odlamy: 0,
      rany: Object.assign({}, window.SolidWounds && window.SolidWounds.stats), trafienia: Object.assign({}, HB.__solidHitRec) };
    if (b && !b.dead) {
      const s = b.nodeStore, lim = HB.config.weaponBand + 0.5 * b.cellSize, w = { x: 0, y: 0, z: 0 };
      let n = 0, pas = 0;
      for (let i = 0; i < s.count; i++) { if (!s.active[i]) continue; n++; HB.nodeWorld(hull, i, w); if (Math.abs(w.z) <= lim) pas++; }
      out.wieza = { wezly: n, wPasie: pas, zamrozona: !!b.anchored, spi: !!b.isSleeping };
    }
    for (const p of hs ? hs.pieces : []) {
      if (p.kind !== 'disc') continue;
      out.dysk.wszystkie++;
      const bb = p.entity && p.entity.beamHull && p.entity.beamHull.body;
      if (bb && !bb.dead) { out.dysk.zywe++; out.dysk.wezly += bb.activeNodes; }
    }
    out.odlamy = (window.wrecks || []).filter((x) => x.solid3D && !x.dead).length;
    const st = window.StoryGame.site.structures.habitat;
    out.habitat = { proc: +(100 * st.hp / st.maxHp).toFixed(1), zniszczony: !!st._destroyed3D || !(st.hp > 0) };
    return out;
  })()`);
  // cele: punkty przekroju wieży z pasem wzdłuż osi przekroju (PCA w XY), 7 punktów od nasady do głowy; oś i normalna
  const cele = await ev(`(() => {
    const HB = window.HullBodies, hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat');
    const tw = hs && hs.neck && hs.neck.tower, hull = tw && tw.beamHull, b = hull && hull.entity === tw ? hull.body : null;
    if (!b) return null;
    const s = b.nodeStore, lim = HB.config.weaponBand + 0.5 * b.cellSize, w = { x: 0, y: 0, z: 0 }, P = [];
    for (let i = 0; i < s.count; i++) { if (!s.active[i]) continue; HB.nodeWorld(hull, i, w); if (Math.abs(w.z) <= lim) P.push([w.x, w.y]); }
    if (P.length < 10) return null;
    let mx = 0, my = 0; for (const p of P) { mx += p[0]; my += p[1]; } mx /= P.length; my /= P.length;
    let sxx = 0, syy = 0, sxy = 0; for (const p of P) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(a), uy = Math.sin(a);
    const T = P.map((p) => (p[0] - mx) * ux + (p[1] - my) * uy);
    const ts = T.slice().sort((x, y) => x - y);
    const t0 = ts[Math.floor(ts.length * 0.04)], t1 = ts[Math.floor(ts.length * 0.96)];
    const pts = [];
    for (let k = 0; k < 7; k++) {
      const tk = t0 + (t1 - t0) * (k + 0.5) / 7;
      let best = null, bd = Infinity;
      for (let i = 0; i < P.length; i++) { const d = Math.abs(T[i] - tk); if (d < bd) { bd = d; best = P[i]; } }
      pts.push(best);
    }
    const d = window.StoryGame.site.dock, hc = d.habitat, H = d.layout.habitat;
    return { pts, ux, uy, nx: -uy, ny: ux, mx, my, t0, t1, pas: P.length, hab: [hc.x, hc.y], drumR: H.drumR, discR: H.discR };
  })()`);
  if (!cele) { console.log('ostrzał: brak wieży w pasie'); report.tryby.ostrzal = { blad: 'brak wieży w pasie' }; return; }
  console.log('ostrzał: przekrój wieży z pasem', cele.pas, 'węzłów, długość', Math.round(cele.t1 - cele.t0), 'j., cele', cele.pts.length);
  // Atlas w wolnym miejscu na normalnej do osi wieży (obwiednie kawałków bazy w świecie gry, okręty), dziobem na wieżę
  const miejsce = await ev(`(() => {
    const S = window.StoryGame, d = S.site.dock, l = d.layout, C = ${JSON.stringify(cele)};
    const boxes = [];
    for (const c of l.chunkById.values()) {
      if (!c.box) continue;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, z] of [[c.box.x0, c.box.z0], [c.box.x1, c.box.z0], [c.box.x0, c.box.z1], [c.box.x1, c.box.z1]]) {
        const g = d.toGame(x, z); x0 = Math.min(x0, g.x); x1 = Math.max(x1, g.x); y0 = Math.min(y0, g.y); y1 = Math.max(y1, g.y);
      }
      boxes.push([x0, x1, y0, y1]);
    }
    const ents = (window.npcs || []).filter((n) => n && !n.dead).map((n) => [n.pos ? n.pos.x : n.x, n.pos ? n.pos.y : n.y, n.radius || 300]);
    let best = null;
    for (const D of [3000, 3800, 4600, 5400, 6200]) for (const side of [1, -1]) for (const sh of [0, -0.35, 0.35]) {
      const x = C.mx + C.nx * side * D + C.ux * sh * D, y = C.my + C.ny * side * D + C.uy * sh * D;
      let dmin = Infinity;
      for (const b of boxes) { const dx = Math.max(b[0] - x, 0, x - b[1]), dy = Math.max(b[2] - y, 0, y - b[3]); dmin = Math.min(dmin, Math.hypot(dx, dy)); }
      for (const e of ents) dmin = Math.min(dmin, Math.hypot(e[0] - x, e[1] - y) - e[2]);
      if (!best || dmin > best.wolne) best = { x, y, wolne: Math.round(dmin), D, side };
      if (dmin >= 1400) return best;
    }
    return best;
  })()`);
  await ev(`(() => {
    const p = ${JSON.stringify(miejsce)}, C = ${JSON.stringify(cele)};
    const a = Math.atan2(C.my - p.y, C.mx - p.x);
    window.StoryGame.deps.placePlayer(p.x, p.y, a);
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    return true;
  })()`);
  console.log('ostrzał: Atlas', JSON.stringify(miejsce));
  await sleep(4000);
  await ev(`(() => {
    const c = window.camera;
    if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
    c.x = c.targetX = ${cele.mx}; c.y = c.targetY = ${cele.my}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${Number(args.zoomOstrzal || 0.2)};
    return true;
  })()`);
  await sleep(800);
  await shot('ostrzal-00-przed');
  const tStart = await ev('performance.now()');
  const czasy = () => ev('(() => { const R = window.__physRec; if (!R) return null; const o = { fizyka: [+(R.sum / Math.max(1, R.n)).toFixed(2), +R.max.toFixed(1)], klatka: [+(R.fsum / Math.max(1, R.fn)).toFixed(1), +R.fmax.toFixed(1)], klatki: R.fn, ponad50ms: R.fslow }; R.n = 0; R.sum = 0; R.max = 0; R.fn = 0; R.fsum = 0; R.fmax = 0; R.fslow = 0; return o; })()');
  await czasy();
  const bronie = String(args.bronie || 'special_yamato_cannon,armata_mk1,beam_pulse,missile_rack,siege_railgun').split(',');
  const wyniki = [];
  const przed0 = await stan();
  console.log('ostrzał: stan przed', JSON.stringify(przed0));
  const krok = (przed, po, extra) => ({ ...extra, wiezaPrzed: przed.wieza, wiezaPo: po.wieza,
    zabite: (przed.wieza?.wezly || 0) - (po.wieza?.wezly || 0),
    kratery: (po.trafienia.kratery || 0) - (przed.trafienia.kratery || 0),
    stemple: (po.rany.stamps || 0) - (przed.rany.stamps || 0), rozdarcia: (po.rany.tears || 0) - (przed.rany.tears || 0),
    odlamy: po.odlamy });
  for (const bron of bronie) {
    const przed = await stan();
    const strzaly = Number(args.serie || 24);
    await ev(`new Promise((res) => {
      const C = ${JSON.stringify(cele)}, rocket = ${JSON.stringify(bron)}.includes('missile') || ${JSON.stringify(bron)}.includes('rack');
      let k = 0;
      const tick = () => {
        const p = C.pts[k % C.pts.length], side = (k & 1) ? 1 : -1;
        const mx = p[0] + C.nx * side * 1800, my = p[1] + C.ny * side * 1800;
        const dx = p[0] - mx, dy = p[1] - my, len = Math.hypot(dx, dy) || 1;
        const target = rocket ? { x: p[0], y: p[1], dead: false, _isPositionTarget: true } : null;
        try { window.fireWeaponCore(window.ship, target, ${JSON.stringify(bron)}, { pos: { x: mx, y: my }, dir: { x: dx / len, y: dy / len }, baseVel: { x: 0, y: 0 } }); } catch (e) { console.error('[ostrzał] strzał', e); }
        if (++k >= ${strzaly}) { clearInterval(h); res(k); }
      };
      const h = setInterval(tick, 120);
      tick();
    })`, 60000);
    await sleep(2500);
    const po = await stan();
    const w = krok(przed, po, { bron, strzaly, czasy: await czasy() });
    wyniki.push(w);
    console.log('ostrzał', bron, JSON.stringify(w));
    await shot(`ostrzal-${String(wyniki.length).padStart(2, '0')}-${bron}`);
  }
  // Hexlance: Atlas dziobem w środek przekroju wieży, ładowanie i strzał z gniazd okrętu (seria z danych broni)
  {
    const przed = await stan();
    await ev(`(() => {
      const C = ${JSON.stringify(cele)}, s = window.ship;
      window.StoryGame.deps.placePlayer(s.pos.x, s.pos.y, Math.atan2(C.my - s.pos.y, C.mx - s.pos.x));
      s.vel.x = 0; s.vel.y = 0;
      const W = window.Superweapon; W.superweaponState.cooldown = 0;
      return W.tryFireSuperweapon(s);
    })()`);
    const armed = await waitFor(cdp, '!!window.Superweapon.superweaponState.armed', 6000, 40);
    const fired = armed ? await ev('window.Superweapon.tryFireSuperweapon(window.ship)') : false;
    await sleep(3000);
    const po = await stan();
    const w = krok(przed, po, { bron: 'hexlance', strzaly: fired ? 1 : 0, czasy: await czasy() });
    wyniki.push(w);
    console.log('ostrzał hexlance', JSON.stringify(w));
    await shot(`ostrzal-${String(wyniki.length).padStart(2, '0')}-hexlance`);
  }
  // dysk mieszkalny (pod pasem): pociski w dysk poza bębnem mijają; Supernowa — kula fali sięga w dół
  const dyskCel = `const C = ${JSON.stringify(cele)};
    const r = (C.drumR + C.discR) / 2, a = Math.atan2(C.my - C.hab[1], C.mx - C.hab[0]) + Math.PI * 0.75;
    const tx = C.hab[0] + Math.cos(a) * r, ty = C.hab[1] + Math.sin(a) * r;`;
  // --profil 1: profil CPU od serii w dysk do końca okna Supernowej (próbkowanie 200 µs) → <out>/supernowa.cpuprofile;
  // start profilera sam zatrzymuje stronę na ~1 s — tu, przed seriami, nie w oknie wybuchu
  if (args.profil) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
    await sleep(1500);
  }
  const dyskPrzed = await stan();
  await ev(`new Promise((res) => {
    ${dyskCel}
    let k = 0;
    const tick = () => {
      const mx = tx + Math.cos(a + 1.3) * 1800, my = ty + Math.sin(a + 1.3) * 1800, dx = tx - mx, dy = ty - my, len = Math.hypot(dx, dy) || 1;
      try { window.fireWeaponCore(window.ship, null, 'special_yamato_cannon', { pos: { x: mx, y: my }, dir: { x: dx / len, y: dy / len }, baseVel: { x: 0, y: 0 } }); } catch (e) { console.error('[ostrzał] dysk', e); }
      if (++k >= 12) { clearInterval(h); res(k); }
    };
    const h = setInterval(tick, 120);
    tick();
  })`, 30000);
  await sleep(2500);
  const dyskPociski = await stan();
  const czasyPociski = await czasy();
  await ev(`(() => {
    ${dyskCel}
    const mx = tx + Math.cos(a + 1.3) * 3000, my = ty + Math.sin(a + 1.3) * 3000, dx = tx - mx, dy = ty - my, len = Math.hypot(dx, dy) || 1;
    try { window.fireWeaponCore(window.ship, { x: tx, y: ty, dead: false, _isPositionTarget: true }, 'supernova_missile', { pos: { x: mx, y: my }, dir: { x: dx / len, y: dy / len }, baseVel: { x: 0, y: 0 } }); } catch (e) { console.error('[ostrzał] supernowa', e); }
    return true;
  })()`);
  // oś czasu po Supernowej: co 250 ms stan habitatu, dysku, odłamów i czasy klatek (gdzie wypada najdłuższa klatka)
  const osSupernowej = [];
  for (let k = 0; k < 28; k++) {
    await sleep(250);
    const s = await stan();
    osSupernowej.push({ t: +((k + 1) * 0.25).toFixed(2), habitat: s.habitat, dysk: s.dysk.zywe, odlamy: s.odlamy, czasy: await czasy() });
    console.log('supernowa', JSON.stringify(osSupernowej[osSupernowej.length - 1]));
  }
  if (args.profil) {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync(join(out, 'supernowa.cpuprofile'), JSON.stringify(profile));
    console.log('profil CPU →', join(out, 'supernowa.cpuprofile'));
  }
  const dyskSupernowa = await stan();
  await shot('ostrzal-dysk-supernowa');
  const pipes = await ev(`(() => { const p = (window.__pipeRec ? window.__pipeRec.pipes : []).filter((x) => x.t >= ${tStart}); const sync = p.filter((x) => x.sync); return { wszystkie: p.length, sync: sync.length, lista: sync.slice(0, 30).map((x) => x.nazwa) }; })()`);
  const dysk = { przed: dyskPrzed.dysk, poPociskach: dyskPociski.dysk, poSupernowej: dyskSupernowa.dysk,
    krateryPociski: (dyskPociski.trafienia.kratery || 0) - (dyskPrzed.trafienia.kratery || 0),
    czasyPociski, osSupernowej };
  console.log('ostrzał: dysk', JSON.stringify(dysk), '| koniec', JSON.stringify(dyskSupernowa), '| pipeline', JSON.stringify(pipes));
  report.tryby.ostrzal = { cele: { pas: cele.pas, punkty: cele.pts.length, dlugosc: Math.round(cele.t1 - cele.t0) }, atlas: miejsce,
    przed: przed0, wyniki, dysk, koniec: dyskSupernowa, pipeline: pipes };
}

try {
  for (const t of tryby) {
    if (t === 'szyja') { await szyja(); continue; }
    if (t === 'ostrzal') await ostrzal('habitat');
    else if (t === 'magazyn') await ostrzal('warehouse');
    else if (t === 'pomosty') await ostrzal('piers');
    else if (t === 'taran') await taran();
  }
  report.bledy = logs.errors().slice(0, 40);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
