// LOT POCISKU (Yamato, Tempest Ion) — warianty efektu lotu w PRAWDZIWEJ grze (A/B na zegarze wirtualnym harnessu,
// klatka 1/60 s). Zgłoszenie użytkownika 2026-10-13: za pociskami Yamato i Tempesta ciągnął się „łańcuszek z
// choinki” — dawne receptury `fly` (src/3d/weapons/recipes.js) wypuszczały grudkę łuków i iskier RAZ NA KLATKĘ
// w miejscu pocisku tej klatki (7–9 tys. j/s → grudki co ~110–150 j.). Dziś obie bez efektu lotu; Yamato ma ogon
// komety ORB w shaderze (projectiles.js, streak 0,035), Tempest — igłę ION z helisą łuków (shader).
//
//   node scripts/webgpu/lot-pocisku-gra.mjs [--bron yamato|tempest|<id broni main>] [--warianty teraz,stary,lancuszek,krotki,smuga]
//        [--ciagly 1] [--znacznik 1]
// --znacznik 1 — po wariantach (można --warianty ''): kamera statku, salwa Yamato w cel, dziennik klatka po klatce
//   (kopnięcie kadru CameraRig.kick w px, znacznik trafienia window.__playerHitMarker — tarcza / kadłub / zniszczenie)
//   i zrzuty celownika ze znacznikiem: <out>/znacznik-*.png.
//        [--out .tmp/lot-pocisku-<broń>] [--rozmiar 1600x900] [--port 5381] [--zoomy 0.22,0.5] [--czasy 0.12,0.25,0.4]
//        [--cel 6500]
//
// Warianty (podmiana w stronie, bez zmiany plików — każdy to osobna salwa w tym samym miejscu):
//   teraz     — receptura z repo,
//   lancuszek — dawny efekt lotu tej broni (grudka raz na klatkę); Yamato także dawny krótki ogon (streak 0,004),
//   krotki    — Yamato: bez efektu lotu, krótki ogon (streak 0,004) — „same pociski”,
//   dlugi     — Tempest: dłuższa igła (streak 0,012),
//   smuga     — smuga gazu z trails.js (TRAIL.yamato / TRAIL.tempest) jak przed decyzją 2026-10-04,
//   stary     — wygląd pocisków sprzed 2026-10-13 (window.ProjectileLook: bez migawki, bez najmniejszej szerokości
//               na ekranie, bez rdzenia pikselowego) — A/B „feelu” lotu przy domyślnym kadrze (--zoomy 0.18).
// Yamato strzela spustem broni specjalnej (DevScene.fireSpecial), Tempest Ion L i inne bronie main (--bron <id>, np.
// armata_mk1, vulcan_minigun, lance_rail_l) z gniazd main na auto (postawa „swobodny” do pierwszego strzału). Zrzuty: <out>/<wariant>-z<zoom>-t<czas>.png (zoom < 0,4 — kamera nad torem,
// większy — nad głową salwy). Raport: <out>/raport.json (błędy konsoli — ma być pusto).
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const BRON = String(args.bron || 'yamato');
const CONF = {
  yamato: { warianty: 'teraz,lancuszek,krotki,smuga', cel: 6500, re: 'yamato', speed: 9000, main: null },
  tempest: { warianty: 'teraz,lancuszek,dlugi,smuga', cel: 4500, re: 'tempest|railgun', speed: 9000, main: 'tempest_ion_l' }
}[BRON] || { warianty: 'teraz,stary', cel: 3000, re: BRON, speed: 6000, main: BRON };
const WARIANTY = String(args.warianty ?? CONF.warianty).split(',').filter(Boolean);
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || `.tmp/lot-pocisku-${BRON}`);
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const ZOOMY = String(args.zoomy || '0.22,0.5').split(',').map(Number);
const CZASY = String(args.czasy || '0.12,0.25,0.4').split(',').map(Number);
const CEL = Number(args.cel || CONF.cel);
const CIAGLY = !!Number(args.ciagly || 0);
const ZNACZNIK = !!Number(args.znacznik || 0);   // po wariantach: znacznik trafienia i kopnięcie kadru (Yamato)   // bronie main: ogień na auto przez całą serię zrzutów (strumień pocisków)

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { bron: BRON, warianty: {}, bledy: [] };

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
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30 && !!window.camera && !!window.WeaponFx && !!window.DevScene?.mountSpecial', 300000, 400)) throw new Error('gra swobodna nie ruszyła');
  await sleep(2000);
  // Pusta przestrzeń między Wenus a Ziemią, gracz nieśmiertelny, bez mgły wojny (jak wystrzal-gra).
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

// Warianty efektu lotu: podmiana RECIPES[rodzina].fly (fasada czyta ją co klatkę) i stanu pocisku przy narodzinach
// (WeaponFx._initBulletState — konfiguracja pocisku, smuga).
const INSTALL = `(async () => {
  if (window.__yv !== undefined) return true;
  const FAM = ${JSON.stringify(BRON === 'yamato' || BRON === 'tempest' ? BRON : null)};
  const R = (await import('/src/3d/weapons/recipes.js')).RECIPES;
  const LOOK = window.ProjectileLook; const LOOK0 = JSON.parse(JSON.stringify(LOOK));
  const { K } = await import('/src/3d/weapons/gpuFx.js');
  const { fxRandom } = await import('/src/3d/fx/fxRandom.js');
  const { SimClock, CLOCK_RENDER } = await import('/src/game/simClock.js');
  const { TRAIL } = await import('/src/3d/weapons/trails.js');
  const orig = FAM ? R[FAM].fly : null;
  // Dawne efekty lotu (przed 2026-10-13): grudka w miejscu pocisku tej klatki, gdy przeleciał ≥ krok.
  function flyStary(ctx, p, x0, y0, x1, y1) {
    const ddx = x1 - x0; const ddy = y1 - y0;
    p.flyAcc += Math.sqrt(ddx * ddx + ddy * ddy);
    const l = Math.sqrt(p.rvx * p.rvx + p.rvy * p.rvy) || 1;
    const fx = p.rvx / l; const fy = -p.rvy / l;   // kierunek lotu w scenie (y odbite)
    if (FAM === 'yamato') {
      if (p.flyAcc < 140) return;
      p.flyAcc = 0;
      ctx.fx.arc.begin(0, fxRandom.round(2)).at(x1, -y1).dir(-fx, -fy).cone(1.2, 0.18).speed(30, 80).life(0.06, 0.14).color(1.2, 2.6, 3.8).x01(8, 1.6).emit();
      ctx.fx.spark.begin(K.SPARK, fxRandom.round(4)).at(x1, -y1).dir(-fx, -fy).cone(0.9, 0.18).speed(100, 400).life(0.2, 0.5).drag(1, 1)
        .color(1.6, 2.6, 3.8).x01(30, 1.0).x23(1.1, 1.4).emit();
    } else {
      if (p.flyAcc < 110) return;
      p.flyAcc = 0;
      ctx.fx.arc.begin(0, fxRandom.round(1)).at(x1, -y1).dir(-fy, fx).cone(2.4, 0.18).speed(8, 22).life(0.05, 0.1).color(1.2, 2.4, 3.8).x01(3, 1.1).emit();
      ctx.fx.spark.begin(K.SPARK, fxRandom.round(2)).at(x1, -y1).dir(-fx, -fy).cone(1.5, 0.18).speed(60, 200).life(0.15, 0.35).drag(1, 1)
        .color(1.4, 2.4, 3.6).x01(14, 1.05).x23(1.2, 1.2).emit();
    }
  }
  window.__yvSet = (m) => {
    window.__yv = m;
    if (FAM) R[FAM].fly = m === 'lancuszek' ? flyStary : orig;
    Object.assign(LOOK, JSON.parse(JSON.stringify(LOOK0)));
    if (m === 'stary') { LOOK.shutter = 0; LOOK.minGrow = 1; LOOK.pixelCore = 0; }
    return true;
  };
  const F = window.WeaponFx; const init = F._initBulletState;
  F._initBulletState = function (st, b, x, y, vx, vy) {
    init.call(this, st, b, x, y, vx, vy);
    const m = window.__yv;
    if (st.family !== FAM) return;
    if (FAM === 'yamato' && (m === 'lancuszek' || m === 'krotki')) st.conf = Object.assign({}, st.conf, { streak: 0.004 });
    if (FAM === 'tempest' && m === 'dlugi') st.conf = Object.assign({}, st.conf, { streak: 0.012 });
    if (m === 'smuga' && !st.trail) {
      const c = st.conf;
      const age = Math.max(0, Number(b.age) || 0);
      const rvx = vx - st.ivx; const rvy = vy - st.ivy;
      const ct = (st.clock === CLOCK_RENDER ? SimClock.render : SimClock.sim) - age;
      st.trail = this.trails.begin(TRAIL[FAM], x - vx * age, y - vy * age, rvx, rvy, c.trailWidth * st.wScale, c.trailSpacing, c.trailPathUnit,
        st.ivx, st.ivy, ct, st.clock, 14 + (st.z || 0));
    }
  };
  window.__yvSet('teraz');
  const M = window.__mz = { shots: [] };
  window.WeaponShotBus.on((d) => { if (d.shooter !== window.ship) return; M.shots.push({ w: d.weaponId, x: d.x, y: d.y }); });
  return true;
})()`;

// Strzał gracza i czekanie na zdarzenie strzału broni: Yamato — spust special (co 20 klatek ponawiany, wieże muszą
// dojść do kursora), Tempest — gniazda main na auto (postawa „swobodny”, po pierwszym strzale z powrotem „wstrzymać”).
const fireAndWait = (max = 600) => ev(`(async () => {
  const M = window.__mz, H = window.__harness, n0 = M.shots.length, re = /${CONF.re}/;
  const special = ${BRON === 'yamato'};
  if (!special && window.fireControl) window.fireControl.posture = 'free';
  try {
    for (let k = 0; k < ${max}; k++) {
      if (special && k % 20 === 0) window.DevScene.fireSpecial();
      await H.step(1);
      const hit = M.shots.slice(n0).filter((s) => re.test(s.w));
      if (hit.length) return { k, x: hit[0].x, y: hit[0].y, n: hit.length };
    }
    return null;
  } finally { if (window.fireControl && !${CIAGLY}) window.fireControl.posture = 'hold'; }
})()`);

const camAt = (x, y, zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  c.transition = null; window.DevScene?.syncCamera?.();
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  return true;
})()`);

// Pocisk salwy najbliżej celu (głowa salwy).
const headShot = () => ev(`(() => { const b = (window.bullets || []).filter((q) => q && q.life > 0 && /${CONF.re}/.test(q.vfxKey || '')).sort((a, c) => c.x - a.x)[0];
  return b ? { x: b.x, y: b.y } : null; })()`);

async function shot(name) {
  await ev('window.__harness.frames(2)');
  await sleep(80);
  await screenshotPng(cdp, join(out, `${name}.png`));
}

// Cel ćwiczebny (bez mózgu, bez tarczy, nie ginie) w (x, y): wieże gracza mają w co celować.
const target = (x, y, key = 'pirate_battleship') => ev(`(async () => {
  const r = window.spawnCallInShip('${key}', { mode: 'pirate', spawnPos: { x: ${x}, y: ${y} }, pos: { x: ${x}, y: ${y} }, spawnAngle: Math.PI / 2 });
  const e = Array.isArray(r) ? r[0] : r; if (!e) return null;
  e.ai = () => {}; e.hp = e.maxHp = 1e8; if (e.shield) { e.shield.max = 0; e.shield.val = 0; } e.__fogVisible = true;
  window.__mzTarget = e;
  for (let i = 0; i < 60 && !e.beamHull; i++) await window.__harness.step(1);
  return { hull: !!e.beamHull };
})()`);

try {
  const P = await startFree();
  await ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
  await ev('window.__harness.step(20)');
  report.fit = await ev(`(() => { window.DevScene.mountMissile(null);
    const s = window.DevScene.mountSpecial('special_yamato_cannon');
    const m = ${JSON.stringify(CONF.main)} ? window.DevScene.mountMain(${JSON.stringify(CONF.main)}) : null;
    if (window.fireControl) window.fireControl.posture = 'hold'; return { special: s, main: m }; })()`);
  await ev(INSTALL);
  await ev(`(() => { window.DevScene.teleport(${P.x}, ${P.y}, 0); window.ship.angVel = 0; return true; })()`);
  report.cel = await target(P.x + CEL, P.y + 300);
  await ev(`window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300})`);
  await ev('window.__harness.step(60)');
  for (const w of WARIANTY) {
    for (const z of ZOOMY) {
      await ev(`window.__yvSet(${JSON.stringify(w)})`);
      await ev('(() => { try { window.refillPlayerAmmo?.(); } catch (e) { /* */ } return true; })()');
      const f = await fireAndWait();
      if (!f) { console.log(w, 'BRAK STRZAŁU'); continue; }
      let tNow = 0;
      for (const at of CZASY) {
        const n = Math.round((at - tNow) * 60);
        if (n > 0) await ev(`window.__harness.step(${n})`);
        tNow = at;
        const name = `${w}-z${String(z).replace('.', '_')}-t${String(at).replace('.', '_')}`;
        if (z < 0.4) await camAt(P.x + CEL * 0.45, P.y + 150, z);
        else { const h = await headShot(); await camAt(h ? h.x - 700 : P.x + CONF.speed * at - 700, h ? h.y : P.y, z); }
        await shot(name);
        console.log(name);
      }
      report.warianty[`${w}-${z}`] = { strzal: f };
      await ev(`(() => { if (window.fireControl) window.fireControl.posture = 'hold'; return true; })()`);
      await ev('window.__harness.step(330)');
    }
  }
  if (ZNACZNIK) {
    // Kamera statku nad Atlasem, kursor na celu; salwa Yamato ze spustu (grupa w ręku — kopnięcie pełne).
    await ev(`(() => { const c = window.camera; c.mode = 'ship'; c.focusStation = null; c.transition = null; c.manualZoom = true;
      c.zoom = c.targetZoom = c.zoomBase = 0.2; return true; })()`);
    await ev('window.__harness.step(30)');
    await ev(`window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300})`);
    await ev('(() => { try { window.refillPlayerAmmo?.(); } catch (e) { /* */ } return true; })()');
    // tarcza celu włączona na pierwszą salwę (znaczniki tarczy, potem kadłuba po jej zbiciu)
    report.tarczaCelu = await ev(`(() => { const t = window.__mzTarget, s = t && t.shield; if (!s) return null;
      s.max = 6000; s.val = 6000; s.regenTimer = 0; return { max: s.max, stan: s.state ?? null }; })()`);
    const log = await ev(`(async () => {
      const H = window.__harness, K = window.CameraRig.kick, M = window.__playerHitMarker, rows = [];
      const t0 = M.t.slice();
      let fired = null;
      for (let k = 0; k < 200; k++) {
        if (!fired && k % 20 === 0) window.DevScene.fireSpecial();
        window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300});
        await H.step(1);
        if (!fired && window.__mz.shots.some((s) => /yamato/.test(s.w))) fired = k;
        rows.push({ k, kx: +K.x.toFixed(2), ky: +K.y.toFixed(2), m: M.t.map((t, i) => t !== t0[i] ? +(performance.now() / 1000 - t).toFixed(3) : null),
          amt: M.amt.map((a) => +a.toFixed(2)) });
        if (fired !== null && k - fired > 90) break;
      }
      return { fired, rows };
    })()`);
    report.znacznik = log;
    const peak = log.rows.reduce((a, r) => Math.max(a, Math.hypot(r.kx, r.ky)), 0);
    const hits = log.rows.filter((r) => r.m.some((v) => v !== null && v < 0.02));
    console.log('kopnięcie: szczyt', peak.toFixed(1), 'px; klatek z nowym trafieniem', hits.length, 'rodzaje', JSON.stringify([0, 1, 2].map((i) => log.rows.some((r) => r.m[i] !== null))));
    // zrzuty celownika przy nowym trafieniu: kadłub (tarcza 0), potem zniszczenie (cel z małą pulą)
    await ev('window.__harness.step(300)');
    await ev(`(() => { const s = window.__mzTarget?.shield; if (s) { s.max = 0; s.val = 0; } return true; })()`);
    for (const etap of ['kadlub', 'zniszczenie']) {
    if (etap === 'zniszczenie') await ev('window.__harness.step(330)');   // przeładowanie; rdzeń trafionego celu może dojść do detonacji
    // cel padł (Yamato niszczy komorę rdzenia — detonacja mimo puli) — nowy w tym samym miejscu, bez tarczy
    if (await ev('(() => { const t = window.__mzTarget; return !t || t.dead || !window.npcs.includes(t); })()')) {
      await target(P.x + CEL, P.y + 300);
      await ev(`(() => { const s = window.__mzTarget?.shield; if (s) { s.max = 0; s.val = 0; } return true; })()`);
    }
    if (etap === 'zniszczenie') await ev(`(() => { const t = window.__mzTarget; if (t) { t.hp = 1500; } return true; })()`);
    await ev('(() => { try { window.refillPlayerAmmo?.(); } catch (e) { /* */ } return true; })()');
    const got = await ev(`(async () => {
      const H = window.__harness, M = window.__playerHitMarker;
      const t0 = M.t.slice();
      for (let k = 0; k < 240; k++) {
        if (k % 20 === 0) window.DevScene.fireSpecial();
        window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300});
        await H.step(1);
        if (M.t.some((t, i) => t !== t0[i])) return { k, t: M.t.slice(), amt: M.amt.slice() };
      }
      const t = window.__mzTarget;
      console.warn('[znacznik] brak trafienia', JSON.stringify({ strzaly: window.__mz.shots.length, dead: t?.dead, hp: t?.hp,
        wNpcs: window.npcs.includes(t), x: t?.x, y: t?.y, coll: t?.isCollidable, ciało: !!t?.beamHull }));
      return null;
    })()`);
    if (got) {
      const cur = await ev(`window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300})`);
      for (const [n, fr] of [['a', 0], ['b', 4], ['c', 8]]) {
        if (fr) await ev(`window.__harness.step(${fr - (n === 'b' ? 0 : 4)})`);
        await ev(`window.DevScene.pointerAt(${P.x + CEL}, ${P.y + 300})`);
        await shot(`znacznik-${etap}-${n}`);
      }
      report[`znacznik_${etap}`] = { ...got, kursor: cur };
      console.log('znacznik', etap, JSON.stringify(got));
    } else console.log('znacznik', etap, 'BRAK TRAFIENIA');
    }
  }
} catch (e) {
  console.error(e);
  report.blad = String(e && e.stack || e);
  report.logi = logs.all().slice(-60);
} finally {
  report.logiZnacznik = logs.all().filter((l) => /\[znacznik\]/.test(l)).slice(0, 10);
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference|Unable to decode audio|AudioSys/.test(l)).slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.slice(0, 20).join('\n'));
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
