// Misja 2 w PRAWDZIWEJ grze (2026-10-07): zasadzka w pasie asteroid w drodze powrotnej — Vite + headless Chrome
// z WebGPU (CDP).
//
//   node scripts/webgpu/zasadzka-gra.mjs [--walka 20] [--zoom 0.11] [--dok 0] [--out .tmp/zasadzka] [--rozmiar 1600x900]
//
// Skok dev ?story=ambush: Atlas na kursie przed miejscem zasadzki (src/game/story/beltAmbush.js), TRAVEL TO prowadzi
// skok. Co 0,2 s: faza, warp, automat podróży, prędkość, odległość od miejsca; kadry: na kursie, w warpie, chwila
// wyrwania (hamowanie), przylot piratów, próba skoku pod zakłócaczem (klawisz 9 — ma się zerwać), walka wśród skał
// (pętla zdarzeń; Atlas trzymany przy życiu i walczy sam — wieże na auto; po `--walka` s zakłócacz zestrzelony, po
// `--walka` + 15 s reszta, jeśli jeszcze żyją), zakłócacz, skrzydło, kurs przywrócony, dalszy lot (warp znowu).
// --dok 1: czeka też na dok w K-7. Pipeline'y utworzone synchronicznie po starcie fazy.
// Wynik: <out>/*.png, <out>/raport.json (plan miejsca, zdarzenia, próbki, błędy konsoli).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/zasadzka');
const walka = Number(args.walka ?? 20);
const zoom = Number(args.zoom || 0.11);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5376));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { plan: null, zdarzenia: [], probki: [], bledy: [] };
const t0 = Date.now();
const note = (co, extra = {}) => { const z = { s: +((Date.now() - t0) / 1000).toFixed(1), co, ...extra }; report.zdarzenia.push(z); console.log(JSON.stringify(z)); };

// Pipeline'y utworzone SYNCHRONICZNIE (materiał bez rozgrzewki = przestój w klatce) — jak hala-pyl-gra.mjs.
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
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
    const comp = pu.createComputePipeline;
    if (comp) pu.createComputePipeline = function (p, b) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: true, compute: true, nazwa: (p && p.computeProgram && p.computeProgram.name) || (p && p.name) || 'compute' });
      return comp.call(this, p, b);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const KEY9 = { key: '9', code: 'Digit9', windowsVirtualKeyCode: 57, nativeVirtualKeyCode: 57 };
const tap = async (k) => {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await sleep(60);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
};

const SAMPLE = `(() => {
  const S = window.StoryGame, s = window.ship, w = window.warp, nav = window.travelNav, plan = S.ambushPlan;
  const amb = (window.npcs || []).filter((n) => n && n.__storyTag === 'ambush');
  const groups = (S._groups || []).filter((g) => g.tag === 'ambush');
  const alive = amb.filter((n) => !n.dead && n.hp > 0 && !n.warpedOut);
  const jam = amb.find((n) => n.__storyJammer);
  const belt = window.__asteroidBelt;
  const m = belt?.field ? belt.field.sampleMacro(s.pos.x, s.pos.y) : null;
  return {
    t: +S.runner.time.toFixed(2), faza: S.phase,
    warp: w.state, rampa: !!w.exitRamp?.active, hamowanie: !!w.gravityBrake?.active,
    podroz: nav ? (nav.active ? nav.phase : (nav.target ? 'cel' : '-')) : null,
    v: Math.round(Math.hypot(s.vel.x, s.vel.y)),
    doMiejsca: plan ? Math.round((plan.x - s.pos.x) * plan.dirX + (plan.y - s.pos.y) * plan.dirY) : null,
    cel: S.ui.objective ? S.ui.objective.text + (S.ui.objective.progress ? ' [' + S.ui.objective.progress() + ']' : '') : null,
    baner: S.ui.banner?.text || null,
    piraci: amb.length, zywi: alive.length,
    grupy: groups.length, razem: groups.reduce((n, g) => n + g.total(), 0), zabite: groups.reduce((n, g) => n + g.killed(), 0),
    wDoku: !!S.lock,
    zaklocacz: jam ? (jam.dead || !(jam.hp > 0) ? 'zniszczony' : Math.round(Math.hypot((jam.pos ? jam.pos.x : jam.x) - s.pos.x, (jam.pos ? jam.pos.y : jam.y) - s.pos.y))) : null,
    gestosc: m ? +(m.density * 1e9).toFixed(1) : null, pole: m ? +m.cluster.toFixed(2) : null,
    olbrzymy: belt ? belt.giants.readyCount : null,
    atlas: { tarcza: Math.round(s.shield?.val || 0), kadlub: +(window.HullBodies?.structuralState?.(s)?.ratio ?? 1).toFixed(2) }
  };
})()`;

const sample = async () => { const p = await ev(SAMPLE); report.probki.push(p); return p; };
const shot = async (name) => { await screenshotPng(cdp, join(out, `${name}.png`)); note(`kadr ${name}`); };
const setZoom = (z) => ev(`(() => { const c = window.camera; c.minZoom = Math.min(c.minZoom, ${z}); c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${z}; return true; })()`);
const killAmbush = (filter = 'true') => ev(`(() => { let k = 0; for (const n of window.npcs || []) if (n && n.__storyTag === 'ambush' && !n.dead && n.hp > 0 && (${filter})) { window.StoryGame.deps.killNpc(n); k++; } return k; })()`);
async function waitSample(pred, sec, every = 200) {
  const end = Date.now() + sec * 1000;
  while (Date.now() < end) {
    const p = await sample();
    if (pred(p)) return p;
    await sleep(every);
  }
  return null;
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=ambush` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && window.StoryGame.active && window.StoryGame.phase === 'ambush' && !!window.StoryGame.ambushPlan", 300000, 300)) throw new Error('brak fazy ambush');
  report.pipesStart = await ev('window.__pipeRec.pipes.length');
  report.plan = await ev(`(() => {
    const S = window.StoryGame, p = S.ambushPlan, s = window.ship, AU = 42253.52, sun = window.SUN || { x: 0, y: 0 };
    const belt = window.__asteroidBelt;
    // sampleMacro oddaje wspólny obiekt wyniku — kopia przed kolejnymi odczytami
    const m = belt?.field ? { ...belt.field.sampleMacro(p.x, p.y) } : null;
    const giants = belt ? belt.giants.entries.map((e) => ({ id: e.id, odKursu: Math.round(Math.abs((e.x - p.from.x) * p.dirY - (e.y - p.from.y) * p.dirX)), r: Math.round(e.radius) })) : [];
    // gęstość i pole (cluster) na cięciwie: gdzie wypadło miejsce względem najgęstszego skrawka
    let maxD = 0, maxC = 0, maxCAt = 0;
    const L = Math.hypot(p.exit.x - p.entry.x, p.exit.y - p.entry.y);
    for (let i = 0; i <= 200 && belt?.field; i++) {
      const q = belt.field.sampleMacro(p.entry.x + (p.exit.x - p.entry.x) * i / 200, p.entry.y + (p.exit.y - p.entry.y) * i / 200);
      if (q.density > maxD) maxD = q.density;
      if (q.cluster > maxC) { maxC = q.cluster; maxCAt = Math.round(L * i / 200); }
    }
    const placeAt = Math.round(Math.hypot(p.x - p.entry.x, p.y - p.entry.y));
    return { rodzaj: p.kind, olbrzym: p.giant, rAU: +(p.r / AU).toFixed(2), gestoscWzgl: m && maxD > 0 ? +(m.density / maxD).toFixed(2) : null, pole: m ? +m.cluster.toFixed(2) : null,
      poleMaxNaKursie: +maxC.toFixed(2), poleMaxOdWejscia: maxCAt, miejsceOdWejscia: placeAt,
      odAtlasa: Math.round(Math.hypot(p.x - s.pos.x, p.y - s.pos.y)), szerokoscPasa: Math.round(L), giants };
  })()`);
  note('plan', report.plan);
  // Atlas przy życiu — sprawdzamy misję, nie przeżycie
  await ev(`(() => { setInterval(() => { const s = window.ship; if (s?.shield) s.shield.val = s.shield.max; if (s && s.maxHp) s.hp = s.maxHp; }, 250); return true; })()`);
  await sleep(600);
  await shot('10-na-kursie');

  // skok (TRAVEL TO): warp aktywny, potem wyrwanie
  const inWarp = await waitSample((p) => p.warp === 'active', 30);
  if (!inWarp) throw new Error('warp nie ruszył (TRAVEL TO)');
  note('warp', { doMiejsca: inWarp.doMiejsca, v: inWarp.v });
  await shot('20-warp');
  const pulled = await waitSample((p) => p.faza !== 'ambush' || (p.warp === 'idle' && (p.hamowanie || /ZASADZKA/.test(p.baner || ''))), 30, 50);
  if (!pulled) throw new Error('brak wyrwania z warpa');
  note('wyrwanie', { doMiejsca: pulled.doMiejsca, v: pulled.v, baner: pulled.baner, hamowanie: pulled.hamowanie });
  await shot('30-wyrwanie');
  const stopped = await waitSample((p) => p.v < 1500, 5, 100);
  note('wyhamował', { doMiejsca: stopped?.doMiejsca, v: stopped?.v, gestosc: stopped?.gestosc, pole: stopped?.pole });
  await shot('31-wyhamowal');
  await setZoom(zoom);
  const arrived = await waitSample((p) => p.zywi >= 4 && p.zaklocacz !== null, 25, 250);
  note('piraci', { piraci: arrived?.piraci, zaklocacz: arrived?.zaklocacz, cel: arrived?.cel });
  await sleep(1500);
  await shot('40-przylot-piratow');

  // zakłócacz zrywa skok (klawisz 9 — ręczny skok)
  await tap(KEY9);
  const jammed = await waitSample((p) => /ZAKŁÓCANY/.test(p.baner || ''), 3, 50);
  const afterJam = await sample();
  report.zakloceniaSkoku = { baner: jammed?.baner || null, warp: afterJam.warp };
  note('skok pod zakłócaczem', report.zakloceniaSkoku);

  // Walka wśród skał — pętla zdarzeń (Atlas walczy sam: wieże na auto; misja może skończyć zasadzkę wcześniej).
  // Po --walka s zakłócacz zestrzelony (jeśli żyje), po --walka + 15 s reszta; potem kurs wraca i warp rusza dalej.
  const tf = Date.now();
  const seen = { zaklocacz: false, skrzydlo: false, powrot: false, dalszyLot: false, dok: false };
  let lastShot = 0, nShot = 0, killedJam = false, killedAll = false;
  while ((Date.now() - tf) / 1000 < walka + 90) {
    await sleep(250);
    const p = await sample();
    const el = (Date.now() - tf) / 1000;
    if (!seen.zaklocacz && (p.zaklocacz === 'zniszczony' || /Rozbij/.test(p.cel || ''))) {
      seen.zaklocacz = true;
      note('zakłócacz zniszczony', { przezGre: !killedJam, baner: p.baner, cel: p.cel });
      await shot('60-zaklocacz-zniszczony');
    }
    if (!seen.skrzydlo && p.grupy >= 2) {
      seen.skrzydlo = true;
      note('skrzydło', { razem: p.razem, zabite: p.zabite });
      await sleep(1500);
      await shot('70-skrzydlo');
    }
    if (!seen.powrot && p.faza === 'return') {
      seen.powrot = true;
      note('po zasadzce', { cel: p.cel, podroz: p.podroz, zabite: p.zabite, razem: p.razem, przezGre: !killedAll });
      await shot('80-kurs-przywrocony');
      await setZoom(0.06);
    }
    if (seen.powrot && !seen.dalszyLot && p.warp === 'active') {
      seen.dalszyLot = true;
      note('dalszy lot', { podroz: p.podroz, v: p.v });
      await shot('90-dalszy-lot-warp');
      if (!Number(args.dok || 0)) break;
    }
    if (seen.dalszyLot && !seen.dok && p.wDoku) {
      seen.dok = true;
      note('dok', { faza: p.faza });
      await shot('99-dok');
      break;
    }
    if (p.faza === 'ambush' && el - lastShot >= 5) {
      lastShot = el;
      note('walka', { zywi: p.zywi, zabite: p.zabite, razem: p.razem, zaklocacz: p.zaklocacz, cel: p.cel, atlas: p.atlas });
      await shot(`50-walka-${String(nShot++).padStart(2, '0')}`);
    }
    if (!killedJam && el > walka && p.faza === 'ambush') { killedJam = true; await killAmbush('n.__storyJammer'); }
    if (!killedAll && el > walka + 15 && p.faza === 'ambush') { killedAll = true; await killAmbush(); }
  }
  report.przebieg = seen;
  if (!seen.powrot) throw new Error('brak przejścia do return');

  const pipes = await ev('window.__pipeRec.pipes');
  report.pipeline = {
    wszystkie: pipes.length,
    syncPoStarcie: pipes.slice(report.pipesStart).filter((p) => p.sync && !p.compute).map((p) => p.nazwa),
    computePoStarcie: pipes.slice(report.pipesStart).filter((p) => p.compute).map((p) => p.nazwa)
  };
  console.log('pipeline:', JSON.stringify(report.pipeline));
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
