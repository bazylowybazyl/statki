// Czas klatek wybuchu reaktora w PRAWDZIWEJ grze (zadanie 20): pierwszy wybuch w sesji (budowy materiałów i
// pipeline'ów w jego klatkach — rozgrzewka), fazy wybuchu (ładowanie, rozbłysk, iskry) i kilka wybuchów naraz.
// Ten sam scenariusz na tagu webgl-baseline (wybuch w overlayu efektów — worktree tagu, `--backend webgl`) i na
// gałęzi (WebGPU, wybuch w scenie Core3D).
// Klatki krokowane zegarem harnessu (harness-strona.js, 1/60 s), czas CPU klatki = najdłuższe wywołanie rAF strony
// w klatce (pętla gry: w tagu z tickiem overlaya), mierzony prawdziwym zegarem; Core3D.render osobno; GPU — ostatni
// wynik znaczników czasu Core3D (`gpuFrameMs`; w tagu bez overlaya, który rysował własny renderer). Na WebGPU
// dodatkowo budowy NodeBuildera (każda = nowy materiał) i nowe pipeline'y.
//
//   node scripts/webgpu/wybuch-reaktora.mjs [--backend webgpu|webgl] [--out plik.json] [--port 5362] [--powtorz 3]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { startVite, startChrome, attachLogs, waitFor, evaluate, repo, osobneLosowanieUuid, parseArgs, sleep } from './wspolne.mjs';

const args = parseArgs();
const backend = args.backend || 'webgpu';
const out = resolve(repo, args.out || `.tmp/webgpu/zadania/20/wybuch-${backend}.json`);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const repeats = Math.max(1, Number(args.powtorz || 1));

// Pusta przestrzeń jak sesja „reaktor” zrzuty.mjs (statek gracza 40 tys. j. obok, poza kadrem).
const DEEP = { x: 6210000, y: 5330000 };
const REAKTOR = { x: DEEP.x + 150000, y: DEEP.y - 350000 };

const PAGE_SETUP = String.raw`(async () => {
  const S = window.__harness.scene, H = window.__harness, realNow = H.realNow;
  S.hideHud(true);
  DevScene.teleport(${REAKTOR.x + 40000}, ${REAKTOR.y}, 0);
  S.cam(${REAKTOR.x}, ${REAKTOR.y}, 0.5);
  await H.frames(20);
  const rec = window.__wybuchRec = { cur: 0, render: 0, builds: 0, buildMs: 0, what: [] };
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => raf((ts) => { const t0 = realNow(); try { cb(ts); } finally { const d = realNow() - t0; if (d > rec.cur) rec.cur = d; } });
  const C = window.Core3D;
  const origRender = C.render;
  C.render = function (...a) { const t0 = realNow(); const r = origRender.apply(this, a); rec.render += realNow() - t0; return r; };
  const be = C.renderer?.backend;
  if (C.renderer?.isWebGPURenderer && be?.createNodeBuilder) {
    const create = be.createNodeBuilder.bind(be);
    be.createNodeBuilder = (...a) => {
      const nb = create(...a);
      rec.builds++;
      const build = nb.build.bind(nb);
      nb.build = (...b) => {
        const t0 = realNow();
        try { return build(...b); } finally {
          const ms = realNow() - t0;
          rec.buildMs += ms;
          rec.what.push(((nb.material?.name || nb.material?.type || '?') + ':' + (nb.object?.name || nb.object?.type || '?')).slice(0, 60) + ' ' + ms.toFixed(1) + 'ms');
        }
      };
      return nb;
    };
  }
  return true;
})()`;

const COUNTERS = String.raw`(() => {
  const r = window.Core3D.renderer;
  if (r?.isWebGPURenderer) return { pipelines: r._pipelines?.caches?.size ?? null, nodeBuilders: r._nodes?.nodeBuilderCache?.size ?? null };
  return { programs: r?.info?.programs?.length ?? null };
})()`;

// [nazwa, profil, rozmiar, wybuchy, zoom, klatki]
const CASES = [
  ['kapital', 'capital', 300, 1, 0.5, 300],
  ['eskorta', 'escort', 200, 1, 0.5, 150],
  ['lancuch', 'chain', 160, 1, 0.8, 120],
  ['trzy-kapitalne', 'capital', 300, 3, 0.35, 300]
];

function caseJs([name, profile, size, count, zoom, frames], index) {
  return String.raw`(async () => {
    const S = window.__harness.scene, H = window.__harness, realNow = H.realNow, rec = window.__wybuchRec;
    const X = ${REAKTOR.x}, Y = ${REAKTOR.y + index * 15000};
    S.cam(X, Y, ${zoom});
    await H.frames(10);
    for (let i = 0; i < 300 && !S.uploadsIdle(); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    const counters = () => (${COUNTERS});
    const frame = async () => {
      rec.cur = 0; rec.render = 0; rec.buildMs = 0; rec.what = [];
      const b0 = rec.builds;
      await H.step(1);
      const blow = window.__reactorBlow3D;
      const ov = window.overlay3D?.getStats?.();
      return { ms: +rec.cur.toFixed(2), render: +rec.render.toFixed(2), gpu: Number.isFinite(Core3D.gpuFrameMs) ? +Core3D.gpuFrameMs.toFixed(3) : null,
        budowy: rec.builds - b0, budowyMs: +rec.buildMs.toFixed(2), co: rec.what.slice(0, 8),
        iskry: blow ? blow.fire.pool.highWater : (ov ? ov.activeEffects : null), wybuchMs: blow ? +blow.stats.cpuMs.toFixed(3) : (ov ? +(+ov.lastRenderMs || 0).toFixed(3) : null) };
    };
    // Klatki bez wybuchu (ten sam kadr, zegar biegnie).
    const idle = [];
    for (let k = 0; k < 30; k++) idle.push(await frame());
    const before = counters();
    H.reseed(0x20f0 + ${index});
    for (let i = 0; i < ${count}; i++) triggerReactorBlow3D(X + (i - (${count} - 1) / 2) * 1500, Y, ${size}, { profile: '${profile}' });
    const rows = [];
    for (let k = 0; k < ${frames}; k++) rows.push({ k, ...(await frame()) });
    // Wygaszenie przed kolejnym przypadkiem (iskry do 4 s po rozbłysku).
    await H.step(120);
    return { name: '${name}', profile: '${profile}', size: ${size}, count: ${count}, idle, rows, before, after: counters() };
  })()`;
}

const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
// Czas ładowania profili (reactorblow.js / reactorProfiles — bez zmian w porcie): klatka rozbłysku przy kroku 1/60 s
// (w tagu licznik cząstek overlaya jest niedostępny — tam tylko z czasu).
const CHARGE_S = { capital: 0.8, escort: 0.3, chain: 0.035 };
const summarize = (c) => {
  const pick = (from, to, key) => med(c.rows.filter((r) => r.k >= from && r.k < to).map((r) => r[key]));
  const cfgCharge = CHARGE_S[c.profile] ?? null;
  const byCount = c.rows.findIndex((r, i) => i > 0 && r.iskry > c.rows[i - 1].iskry + 10);
  const flash = byCount >= 0 ? byCount : (cfgCharge !== null ? Math.ceil(cfgCharge * 60) : -1);
  const ms = c.rows.map((r) => r.ms);
  return {
    przypadek: c.name, wybuchy: c.count,
    bezWybuchu: { ms: med(c.idle.map((r) => r.ms)), render: med(c.idle.map((r) => r.render)), gpu: med(c.idle.map((r) => r.gpu)) },
    klatka0: { ms: c.rows[0].ms, render: c.rows[0].render, budowy: c.rows[0].budowy },
    ladowanie: { ms: pick(1, Math.max(2, flash), 'ms'), render: pick(1, Math.max(2, flash), 'render'), gpu: pick(3, Math.max(4, flash), 'gpu') },
    rozblyskKlatka: flash, rozblysk: flash >= 0 ? c.rows.slice(flash, flash + 3).map((r) => ({ k: r.k, ms: r.ms, render: r.render, gpu: r.gpu, budowy: r.budowy, iskry: r.iskry })) : null,
    iskry: flash >= 0 ? { ms: pick(flash + 6, flash + 120, 'ms'), render: pick(flash + 6, flash + 120, 'render'), gpu: pick(flash + 6, flash + 120, 'gpu'), wybuchMs: pick(flash + 6, flash + 120, 'wybuchMs'), iskry: c.rows[Math.min(c.rows.length - 1, flash + 6)].iskry } : null,
    // Ostatnie 30 klatek przypadku (wybuch dogasa albo już zgasł).
    koniec: { ms: pick(c.rows.length - 30, c.rows.length, 'ms'), render: pick(c.rows.length - 30, c.rows.length, 'render'), gpu: pick(c.rows.length - 30, c.rows.length, 'gpu') },
    maksMs: Math.max(...ms), maksKlatka: ms.indexOf(Math.max(...ms)),
    budowy: c.rows.reduce((a, r) => a + (r.budowy || 0), 0), budowyMs: +c.rows.reduce((a, r) => a + (r.budowyMs || 0), 0).toFixed(2),
    klatkiZBudowami: c.rows.filter((r) => r.budowy > 0).map((r) => ({ k: r.k, budowy: r.budowy, ms: r.budowyMs, co: r.co })),
    pipelineNowe: (c.after.pipelines ?? 0) - (c.before.pipelines ?? 0), programyNowe: (c.after.programs ?? 0) - (c.before.programs ?? 0),
    ladowanieS: cfgCharge
  };
};

const { server, base } = await startVite(Number(args.port || 5362));
const results = [];
try {
  for (let rep = 1; rep <= repeats; rep++) {
    const chrome = await startChrome({ width: 1920, height: 1080 });
    const logs = await attachLogs(chrome);
    const { cdp } = chrome;
    const ev = (e, t = 600000) => evaluate(cdp, e, t);
    try {
      await osobneLosowanieUuid(cdp);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
      await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&renderer=${backend}` });
      if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
      await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
      if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
      await ev('window.__harness.hold(true)');
      await ev(PAGE_SETUP);
      // Rozgrzewki (klatka efektów, requestIdleCallback) i wgrywanie tekstur — czas rzeczywisty, bez klatek gry.
      await sleep(6000);
      await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
      const run = { rep, cases: [] };
      for (const [i, c] of CASES.entries()) {
        const r = await ev(caseJs(c, i));
        const s = summarize(r);
        run.cases.push({ ...s, klatki: r.rows.map((x) => [x.k, x.ms, x.render, x.gpu, x.budowy, x.iskry]) });
        console.log(`${backend} p${rep} ${s.przypadek}: bez wybuchu ${JSON.stringify(s.bezWybuchu)}, k0 ${JSON.stringify(s.klatka0)}, ładowanie ${JSON.stringify(s.ladowanie)}, rozbłysk k${s.rozblyskKlatka} ${JSON.stringify(s.rozblysk?.map((x) => [x.ms, x.render, x.budowy]))}, iskry ${JSON.stringify(s.iskry)}, maks ${s.maksMs} (k${s.maksKlatka}), budowy ${s.budowy} (${s.budowyMs} ms), pipeline +${s.pipelineNowe}, programy +${s.programyNowe}`);
      }
      run.bledy = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
      results.push(run);
    } finally {
      await chrome.close();
    }
  }
} finally {
  await server.close();
}
// Mediany po przebiegach (liczby z podsumowań).
const byCase = {};
for (const run of results) for (const c of run.cases) (byCase[c.przypadek] ||= []).push(c);
const mediany = Object.fromEntries(Object.entries(byCase).map(([k, list]) => [k, {
  bezWybuchuMs: med(list.map((c) => c.bezWybuchu.ms)), bezWybuchuRender: med(list.map((c) => c.bezWybuchu.render)), bezWybuchuGpu: med(list.map((c) => c.bezWybuchu.gpu)),
  klatka0Ms: med(list.map((c) => c.klatka0.ms)), klatka0Render: med(list.map((c) => c.klatka0.render)),
  ladowanieMs: med(list.map((c) => c.ladowanie.ms)), ladowanieRender: med(list.map((c) => c.ladowanie.render)), ladowanieGpu: med(list.map((c) => c.ladowanie.gpu)),
  rozblyskMs: med(list.map((c) => c.rozblysk?.[0]?.ms)), rozblyskRender: med(list.map((c) => c.rozblysk?.[0]?.render)),
  koniecMs: med(list.map((c) => c.koniec.ms)), koniecGpu: med(list.map((c) => c.koniec.gpu)),
  iskryMs: med(list.map((c) => c.iskry?.ms)), iskryRender: med(list.map((c) => c.iskry?.render)), iskryGpu: med(list.map((c) => c.iskry?.gpu)), wybuchCpuMs: med(list.map((c) => c.iskry?.wybuchMs)),
  maksMs: med(list.map((c) => c.maksMs)), budowy: list.map((c) => c.budowy), pipelineNowe: list.map((c) => c.pipelineNowe)
}]));
console.log('mediany:', JSON.stringify(mediany, null, 1));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), backend, mediany, results }, null, 2) + '\n');
console.log('zapisano', out);
process.exit(0);
