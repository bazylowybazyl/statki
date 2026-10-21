// UPADEK HABITATU bazy piratów na planetoidę W GRZE (src/game/story/pirateBaseFall.js; prośba użytkownika 2026-10-19:
// „HP habitatu 0 → góra przebija się przez dół i jako pierwsza spada na planetoidę, za nią dół pociągnięty przez
// wieżę; w końcu wszystkie elementy spadają na planetoidę”). Vite + headless Chrome z WebGPU, skok dev ?story=shipyard.
//
//   node scripts/webgpu/upadek-gra.mjs [--warianty stoi,lezy] [--kamera top,3d] [--out .tmp/upadek] [--query renderWorker=0]
//     [--rozmiar 1600x900] [--czas 34] [--fall k=v,k2=v2] (PIRATE_FALL_TUNE w locie) [--seria 1.5] (kadr co 1,5 s od
//     uderzenia wieży); wiersze stanu: `gaz` — domeny głębokie wg znacznika (10 uderzenia, 9 wyrwy): [liczba, bok km]
//
// stoi — HP 0 habitatu przy stojącej wieży (gracz zestrzelił resztę bez taranu szyi)
// lezy — najpierw zerwanie szyi (window.snapPirateBaseNeck), wieża leży na dysku i zamarza, potem HP 0
// kamera top — z góry (RTS): zbliżenie na habitat przy przebiciu dysku, potem oddalenie nad skałę (upadek, uderzenia);
// kamera 3d — kamera 3D (Game3D 'tactical') krążąca wokół wieży (Game3D.focusEntity) od HP 0 do osiadania;
// kamera gra — kamera statku jak u gracza (ujęcie upadku robi fabuła: lookAt nad habitat i skałę).
// --progi 1 — przed HP 0 cztery trafienia w ćwiartki bębna (progi punktów łamią je płasko, odłamy dryfują).
// Co 0,25 s: faza upadku, wieża (z, prędkość), sektory dysku puszczone, uderzenia, zamrożone, czas kroku fizyki i klatki;
// kadry w chwilach sekwencji; pipeline'y renderu tworzone synchronicznie w scenariuszu (ma być 0). Raport: <out>/raport.json.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/upadek');
mkdirSync(out, { recursive: true });
const warianty = String(args.warianty || 'stoi,lezy').split(',').map((s) => s.trim()).filter(Boolean);
const kamery = String(args.kamera || 'top').split(',').map((s) => s.trim()).filter(Boolean);
const query = args.query ? `&${args.query}` : '';
const czas = Number(args.czas || 34);

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { przebiegi: {}, bledy: [] };

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

async function startStory(phase) {
  for (let i = 0; ; i++) {
    try { return await startStoryOnce(phase); } catch (err) {
      if (i >= 2) throw err;
      console.log(`start fazy ${phase} — ponowienie (${err.message})`);
    }
  }
}
async function startStoryOnce(phase) {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${phase}${query}` });
  if (!await waitFor(cdp, '!!(window.ship && window.StoryGame && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  await sleep(2500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${phase}' && !!window.StoryGame.site?.station`, 120000, 400)) throw new Error(`faza ${phase} nie ruszyła`);
}

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

const camHub = (x, z, zoom) => ev(`(() => {
  const site = window.StoryGame.site, c = window.camera;
  const p = site.dock.toGame(${x}, ${z});
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.transition = null;
  c.x = c.targetX = p.x; c.y = c.targetY = p.y; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
  return true;
})()`);

async function shot(name) {
  await screenshotPng(cdp, join(out, `${name}.png`));
}

const STATE = `(() => {
  const S = window.StoryGame, d = S.site.dock, hc = d.habitat;
  const F = window.PirateBaseFall && window.PirateBaseFall.state();
  const hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat');
  const n = hs && hs.neck;
  const tw = (F && F.tower) || (n && n.tower);
  const b = tw && tw.beamHull && tw.beamHull.entity === tw ? tw.beamHull.body : null;
  const st = S.site.structures.habitat;
  const R = window.__physRec;
  const fiz = R ? [+(R.sum / Math.max(1, R.n)).toFixed(1), +R.max.toFixed(1), R.n] : null;
  const kl = R ? [+(R.fsum / Math.max(1, R.fn)).toFixed(1), +R.fmax.toFixed(1), R.fslow] : null;
  if (R) { R.n = 0; R.sum = 0; R.max = 0; R.fn = 0; R.fsum = 0; R.fmax = 0; R.fslow = 0; }
  let free = 0, frozen = 0;
  for (const s of window.HullBodies._solids) { if (!s || s.dead || s.planar) continue; if (s.anchored) frozen++; else free++; }
  // domeny gazu głębokie (pass tła) wg znacznika: 10 — uderzenia w skałę, 9 — wyrwy (dekompresja), inne — wybuchy;
  // [liczba, bok największej domeny w km] (tryb off: reżyser na stronie)
  const gaz = {};
  const G = window.__explosions && window.__explosions.grid;
  if (G && G.slots) for (const sl of G.slots) {
    if (!sl.active || !sl.deep) continue;
    const k = String(sl.tag || 0), side = sl.h * sl.n / 1000;
    const g = gaz[k] || (gaz[k] = [0, 0]);
    g[0]++; if (side > g[1]) g[1] = +side.toFixed(1);
  }
  return { szyja: n ? n.phase : '-', upadek: F ? F.phase : '-', t: F ? +F.t.toFixed(2) : 0, hp: +(100 * st.hp / st.maxHp).toFixed(1), gaz,
    wieza: b ? [Math.round(b.pos.x - hc.x), Math.round(-b.pos.y - hc.y), Math.round(b.pos.z), Math.round(Math.hypot(b.vel.x, b.vel.y, b.vel.z)), b.activeNodes, b.anchored ? 1 : 0] : null,
    styk: F ? +F.touchT.toFixed(2) : -1, przejscie: F ? +F.passT.toFixed(2) : -1, korek: F ? F.plugN || 0 : 0, sektory: F ? F.released : 0,
    uderzenieWiezy: F ? +F.towerImpactT.toFixed(2) : -1, uderzenieDysku: F ? +F.discImpactT.toFixed(2) : -1, uderzenia: F ? F.impacts : 0, zamrozone: F ? F.frozen : 0,
    bryly: [free, frozen], fizykaMs: fiz, klatkaMs: kl };
})()`;

async function przebieg(wariant, kamera) {
  const tag = `${wariant}-${kamera}`;
  console.log(`\n=== ${tag} ===`);
  await startStory('shipyard');
  await sleep(1500);
  await ev(GUARD);
  if (args.fall) {
    await ev(`(() => { const T = window.PirateBaseFall.tune; ${String(args.fall).split(',').map((kv) => { const [k, v] = kv.split('='); return `T[${JSON.stringify(k)}] = ${Number(v)};`; }).join(' ')} return true; })()`);
  }
  await ev(`(() => {
    if (window.__physRec) return true;
    const R = window.__physRec = { n: 0, sum: 0, max: 0, fn: 0, fsum: 0, fmax: 0, fslow: 0, last: 0 };
    const HB = window.HullBodies, step = HB.step;
    HB.step = function (...a) { const t = performance.now(); const r = step.apply(this, a); const ms = performance.now() - t; R.n++; R.sum += ms; if (ms > R.max) R.max = ms; return r; };
    const raf = (t) => { if (R.last) { const d = t - R.last; R.fn++; R.fsum += d; if (d > R.fmax) R.fmax = d; if (d > 50) R.fslow++; } R.last = t; requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    return true;
  })()`);
  // Atlas po drugiej stronie habitatu niż skała (bańka ciał świata 7 km obejmuje habitat), mgła wojny wyłączona
  await ev(`(() => {
    const S = window.StoryGame, d = S.site.dock;
    const p = d.toGame(-4200, -2600);
    S.deps.placePlayer(p.x, p.y, 0);
    window.ship.vel.x = 0; window.ship.vel.y = 0;
    window.setFogOfWar?.(false);
    for (const el of document.querySelectorAll('.st-hint, .st-objective')) el.style.display = 'none';
    return true;
  })()`);
  await waitFor(cdp, `(() => { const hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat'); return !!hs && hs.pieces.filter((p) => p.state === 'live').length >= 6; })()`, 60000, 300);
  await sleep(1500);
  const t0 = await ev('performance.now()');
  if (wariant === 'lezy') {
    await camHub(0, 0, 0.16);
    await ev(`window.snapPirateBaseNeck(-1, 0.25, 3000)`);
    const ok = await waitFor(cdp, `(() => { const hs = window.WorldBodies.sites.find((q) => q.structure === 'habitat'); return hs && hs.neck && hs.neck.phase === 'landed'; })()`, 40000, 500);
    console.log('szyja wylądowała:', ok);
    await sleep(1000);
    await shot(`${tag}-00-wieza-na-dysku`);
  }
  // kamera
  if (kamera === 'top') await camHub(0, 0, 0.15);
  else if (kamera === 'gra') {
    // kamera gry (statek, z góry): ujęcie upadku robi fabuła (storyGame._habitatFallShot → lookAt)
    await ev(`(() => { const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); window.Game3D?.setCamera('classic');
      c.manualZoom = false; c.targetZoom = 0.42; document.getElementById('cockpit-ui-host')?.classList.remove('hidden'); return c.mode; })()`);
  } else {
    await ev(`(() => { const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); window.Game3D?.setCamera('tactical'); return window.Game3D?.mode; })()`);
  }
  await sleep(600);
  await shot(`${tag}-01-przed`);
  // --progi 1: jak u gracza — habitat zbijany stopniowo w różne ćwiartki bębna (progi punktów łamią je PŁASKO: odłamy
  // dryfują), dopiero potem HP 0 — przy upadku płaskie odłamy też stają się bryłami i spadają (promotePlanarWreck)
  if (args.progi) {
    for (const deg of [20, 110, 200, 290]) {
      const r = await ev(`(() => {
        const S = window.StoryGame, st = S.site.structures.habitat, d = S.site.dock, H = d.layout.habitat;
        const a = ${deg} * Math.PI / 180, p = d.toGame(Math.cos(a) * H.drumR * 0.8, Math.sin(a) * H.drumR * 0.8);
        st.lastHitX = p.x; st.lastHitY = p.y;
        const step = (st.maxHp || 1) / Math.max(1, st.damageSteps || 5);
        if (st.hp - step * 1.02 <= 0) return { hp: st.hp, pominiete: true };
        S.deps.damageStation(st, step * 1.02);
        return { hp: Math.round(100 * st.hp / st.maxHp) };
      })()`);
      console.log(tag, 'próg', deg, JSON.stringify(r));
      await sleep(1500);
    }
    const pl = await ev(`window.wrecks.filter((w) => !w.dead && w.beamHull && w.beamHull.body && w.beamHull.body.planar && w.beamHull.world && w.beamHull.world.fall3d).length`);
    console.log(tag, 'płaskie odłamy habitatu przed HP 0:', pl);
    await shot(`${tag}-01b-progi`);
  }
  // HP 0 habitatu — finał misji (storyGame._chainExplosion → upadek)
  await ev(`(() => { const S = window.StoryGame, st = S.site.structures.habitat; S.deps.damageStation(st, st.hp + 10); return st.hp; })()`);
  const rows = [];
  const kadry = new Set();
  const kadr = async (k) => {
    const key = k.replace(/-[0-9.]+s$/, '');   // kadr serii: jeden na przedział
    if (!kadry.has(key)) { kadry.add(key); await shot(`${tag}-${k}`); }
  };
  let zoomedOut = false;
  for (let i = 0; i < Math.round(czas / 0.25); i++) {
    await sleep(250);
    const s = await ev(STATE);
    rows.push({ s: +(i * 0.25 + 0.25).toFixed(2), ...s });
    if (i % 4 === 3) console.log(tag, JSON.stringify(rows[rows.length - 1]));
    if (kamera === '3d') {
      // kamera 3D krąży wokół wieży (encja wraku 3D)
      await ev(`(() => { const F = window.PirateBaseFall.state(); if (F && F.tower && window.Game3D) window.Game3D.focusEntity = F.tower; return true; })()`);
    }
    if (s.upadek === 'falling' && s.t >= 0.6) await kadr('02-start');
    if (s.styk >= 0 && s.t >= s.styk + 0.4) await kadr('03-przebicie');
    if (s.styk >= 0 && s.t >= s.styk + 1.5) await kadr('04-przez-dysk');
    if (kamera === 'top' && !zoomedOut && s.przejscie >= 0 && s.t >= s.przejscie + 0.5) {
      zoomedOut = true;
      // między habitatem a RZUTEM miejsca lądowania (skała pod bazą w kierunku +x +z układu bazy, szczyt 24 km niżej —
      // lądowanie ~4,6 km w bok, z kamery ~20 km nad płaszczyzną rzut ~2 km)
      await camHub(1000, 1000, 0.07);
    }
    if (s.przejscie >= 0 && s.t >= s.przejscie + 1.2) await kadr('05-dysk-za-wieza');
    if (s.uderzenieWiezy < 0 && s.wieza && s.wieza[2] < -12000) await kadr('06-lot');
    if (s.uderzenieWiezy >= 0) await kadr('07-uderzenie-wiezy');
    if (s.uderzenieWiezy >= 0 && s.t >= s.uderzenieWiezy + 1.2) await kadr('08-po-uderzeniu');
    if (s.uderzenieDysku >= 0 && s.t >= s.uderzenieDysku + 0.6) await kadr('09-uderzenie-dysku');
    // --seria S: kadr co S s od uderzenia wieży (jak pył się rozchodzi i opada)
    if (args.seria && s.uderzenieWiezy >= 0) {
      const k = Math.floor((s.t - s.uderzenieWiezy) / Number(args.seria));
      if (k >= 0 && k < 20) await kadr(`s${String(k).padStart(2, '0')}-${(s.t - s.uderzenieWiezy).toFixed(1)}s`);
    }
    if (s.upadek === 'settled') { await kadr('10-osiadlo'); break; }
  }
  if (args.progi) {
    const pl = await ev(`(() => { const F = window.PirateBaseFall.state(); return { awansowane: F.promotedWrecks || 0, odchylka: Math.round(F.promoteErrMax || 0),
      plaskie: window.wrecks.filter((w) => !w.dead && w.beamHull && w.beamHull.body && !w.beamHull.body.dead && w.beamHull.body.planar && w.beamHull.world && w.beamHull.world.fall3d && w.beamHull.body.activeNodes >= 12).length }; })()`);
    console.log(tag, 'odłamy płaskie po upadku:', JSON.stringify(pl));
    report.progi = report.progi || {};
    report.progi[tag] = pl;
  }
  await shot(`${tag}-11-koniec`);
  const pipes = await ev(`(() => { const p = (window.__pipeRec ? window.__pipeRec.pipes : []).filter((x) => x.t >= ${t0}); const sync = p.filter((x) => x.sync); return { wszystkie: p.length, sync: sync.length, lista: sync.slice(0, 30).map((x) => x.nazwa) }; })()`);
  console.log(tag, 'pipeline w scenariuszu', JSON.stringify(pipes));
  report.przebiegi[tag] = { rows, pipeline: pipes };
}

try {
  for (const w of warianty) for (const k of kamery) {
    try { await przebieg(w, k); } catch (err) { console.error(w, k, err); report.bledy.push(`${w}/${k}: ${err.message}`); }
  }
} finally {
  report.konsola = typeof logs.errors === "function" ? logs.errors().slice(0, 60) : [];
  writeJson(join(out, 'raport.json'), report);
  await chrome.close?.();
  await server.close?.();
}
console.log('raport:', join(out, 'raport.json'));
process.exit(0);
