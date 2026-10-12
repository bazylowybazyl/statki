// Obrona punktowa kontra rakiety 3D w PRAWDZIWEJ grze (2026-10-12): Vite + headless Chrome z WebGPU (CDP).
//
//   node scripts/webgpu/pd-rakiety-gra.mjs [--tryb strzelnica,ttk,fala] [--powtorz 3] [--bron grad_launcher,roj_pod]
//        [--ttkCzas 90] [--falaCzas 40] [--port 5376] [--out .tmp/pd-rakiety]
//
// STRZELNICA (gra swobodna, pusta przestrzeń, gracz nieśmiertelny): salwy rakiet 3D każdego rodzaju
// (rocketSystem3D.fireSalvo, wyrzut z punktu w świecie 5 km od celu) w trzy cele, każdy z dala od reszty:
//   atlas — Atlas gracza (jego obrona punktowa z wyposażenia), salwa „czerwona” (wroga);
//   tn    — pancernik Terra Nova (laser PD), salwa czerwona;
//   pir   — pancernik piratów (CIWS), salwa „niebieska” (strony gracza).
// Na salwę: rakiety (wyrzucone + głowice potomne Hydry), trafienia celu (_onHit), przechwycone przez PD
// (rocketSystem3D.stats.intercepted, gdy istnieje), reszta (koniec zasięgu, chybienie).
// TTK: salwy Grad co przeładowanie (9 s) z 5 km w niszczyciel piratów (niebieskie) i niszczyciel Terra Nova
// (czerwone) — czas do śmierci celu (sufit --ttkCzas).
// FALA: kampania ?story=counter (odwet misji 2) — przez --falaCzas s: rakiety piratów wyrzucone, trafienia
// strony gracza, przechwycone.
// Wynik: <out>/raport.json.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/pd-rakiety');
mkdirSync(out, { recursive: true });
const TRYBY = String(args.tryb || 'strzelnica,ttk').split(',');
const POWTORZ = Number(args.powtorz || 3);
// --ab 1: każda broń z rakietami 3D jako celami PD i bez (rocketSystem3D.pdTargets = false — stan sprzed 2026-10-12).
const WARIANTY = args.ab === '1' ? [false, true] : [true];
const BRONIE = String(args.bron || 'grad_launcher,roj_pod,missile_rack,fast_missile_rack,hydra_mirv,supernova_missile').split(',');

const { server, base } = await startVite(Number(args.port || 5376));
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { strzelnica: [], ttk: [], fala: null, bledy: [] };

// Licznik zdarzeń rakiet: opakowania metod rocketSystem3D (fire, _onHit, _explode) — działa na wersji przed i po.
const TRACK = `(() => {
  const rs = window.rocketSystem3D;
  if (rs.__pdTrack) return true;
  const T = window.__pdT = { fired: 0, split: 0, hits: 0, hitsOn: new Map(), explode: 0, firedHostile: 0 };
  const f = rs.fire, h = rs._onHit, x = rs._explode;
  rs.fire = function (...a) { const r = f.apply(this, a); if (r) { if (r.mode === 2) T.split++; else T.fired++; if (r.hostile) T.firedHostile++; } return r; };
  rs._onHit = function (r, ...a) { const t = r.target; h.call(this, r, ...a); if (r.didImpactDamage) { T.hits++; T.hitsOn.set(t, (T.hitsOn.get(t) || 0) + 1); } };
  rs._explode = function (...a) { T.explode++; return x.apply(this, a); };
  rs.__pdTrack = true;
  return true;
})()`;
const intercepted = `(() => { const s = window.rocketSystem3D.stats?.intercepted; if (!s) return 0; let n = 0; for (const k in s) n += s[k]; return n; })()`;
const interceptedBy = `(() => ({ ...(window.rocketSystem3D.stats?.intercepted || {}) }))()`;

async function startFree() {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30 && !!window.camera && !!window.rocketSystem3D', 300000, 400)) throw new Error('gra nie ruszyła');
  // Pusta przestrzeń (jak profil-bitwy-flot), gracz nieśmiertelny.
  return ev(`(() => {
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
    const aux = (window.Game.player.weapons?.aux || []).map((lo) => lo.weapon?.id);
    return { x: Math.round(best.x), y: Math.round(best.y), aux, ciws: window.ship.ciws?.length };
  })()`);
}

// Cel: 'atlas' albo okręt wezwany daleko od gracza (żeby PD Atlasa nie mieszała się w cudzą salwę).
async function spawnTarget(key, mode, dx, dy) {
  return ev(`(() => {
    const s = window.ship, pos = { x: s.pos.x + ${dx}, y: s.pos.y + ${dy} };
    const r = window.spawnCallInShip(${JSON.stringify(key)}, { mode: ${JSON.stringify(mode)}, spawnPos: pos, pos, spawnAngle: 0 });
    const e = Array.isArray(r) ? r[0] : r;
    window.__pdTarget = e || null;
    return e ? { typ: e.type, aux: (e.weapons?.aux || []).map((lo) => lo.weapon?.id), friendly: !!e.friendly } : null;
  })()`);
}

async function salvo(targetExpr, weaponId, color) {
  // Czekamy na pustą pulę (poprzednia salwa rozstrzygnięta).
  await waitFor(cdp, 'window.rocketSystem3D.activeRockets === 0 && window.rocketSystem3D.pendingLaunches === 0', 60000, 200);
  const before = await ev(`(() => { const T = window.__pdT; return { fired: T.fired, split: T.split, hits: T.hits, explode: T.explode, icp: ${intercepted} }; })()`);
  const shot = await ev(`(() => {
    const t = ${targetExpr}, w = window.MASTER_WEAPONS[${JSON.stringify(weaponId)}];
    if (!t || t.dead || !w) return null;
    const tx = t.pos ? t.pos.x : t.x, ty = t.pos ? t.pos.y : t.y;
    // Wyrzut 5 km od celu (najwyżej 3/4 zasięgu broni), kierunek stały względem świata.
    const d = Math.min(5000, 0.75 * (w.baseRange || 6000)), a = 2.4, ox = tx + Math.cos(a) * d, oy = ty + Math.sin(a) * d;
    const n = Math.max(1, w.burstCount || 1);
    window.rocketSystem3D.fireSalvo(null, ox, oy, t, w.baseDamage, w, ${JSON.stringify(color)}, 0, 0, n, w.burstDelay || 0, a + Math.PI, 0);
    return { n };
  })()`);
  if (!shot) return null;
  await sleep(500);
  await waitFor(cdp, 'window.rocketSystem3D.activeRockets === 0 && window.rocketSystem3D.pendingLaunches === 0', 60000, 200);
  const after = await ev(`(() => { const T = window.__pdT; return { fired: T.fired, split: T.split, hits: T.hits, explode: T.explode, icp: ${intercepted} }; })()`);
  return {
    wyrzucone: after.fired - before.fired, potomne: after.split - before.split,
    trafienia: after.hits - before.hits, przechwycone: after.icp - before.icp, wybuchy: after.explode - before.explode
  };
}

async function strzelnica() {
  const cele = [
    { id: 'atlas', expr: 'window.ship', color: 'red', spawn: null },
    { id: 'tn', expr: 'window.__pdTarget', color: 'red', spawn: ['battleship', 'friendly', 30000, 0] },
    { id: 'pir', expr: 'window.__pdTarget', color: 'blue', spawn: ['pirate_battleship', 'pirate', -30000, 0] }
  ];
  for (const cel of cele) {
    let info = 'Atlas gracza';
    if (cel.spawn) {
      info = await spawnTarget(...cel.spawn);
      // Cel strzelnicy nieśmiertelny (kadłub i tarcza dolewane) — salwy liczą trafienia, nie zabijają.
      await ev(`(() => { clearInterval(window.__pdImmortal); window.__pdImmortal = setInterval(() => { const e = window.__pdTarget;
        if (!e || e.dead) return; e.hp = e.maxHp; if (e.shield) e.shield.val = e.shield.max; }, 100); return true; })()`);
      await sleep(2500);
    }
    console.log(`\n== cel ${cel.id}:`, JSON.stringify(info));
    for (const w of BRONIE) for (const pd of WARIANTY) {
      await ev(`(() => { window.rocketSystem3D.pdTargets = ${pd}; return true; })()`);
      const sum = { cel: cel.id, bron: w, pd, salw: 0, wyrzucone: 0, potomne: 0, trafienia: 0, przechwycone: 0, wybuchy: 0 };
      const icp0 = await ev(interceptedBy);
      for (let k = 0; k < POWTORZ; k++) {
        const r = await salvo(cel.expr, w, cel.color);
        if (!r) break;
        sum.salw++;
        for (const key of ['wyrzucone', 'potomne', 'trafienia', 'przechwycone', 'wybuchy']) sum[key] += r[key];
      }
      const icp1 = await ev(interceptedBy);
      sum.przez = {};
      for (const k in icp1) { const d = (icp1[k] || 0) - (icp0[k] || 0); if (d) sum.przez[k] = d; }
      const glowic = sum.wyrzucone - (w === 'hydra_mirv' ? 0 : 0);
      sum.naSalwe = sum.salw ? +(sum.trafienia / sum.salw).toFixed(2) : 0;
      console.log(`  ${(w + (pd ? ' PD' : ' bez')).padEnd(22)} salw ${sum.salw}  rakiet ${glowic}${sum.potomne ? ' (+' + sum.potomne + ' potomnych)' : ''}  trafień ${sum.trafienia} (${sum.naSalwe}/salwę)  przechwycone ${sum.przechwycone} ${JSON.stringify(sum.przez)}`);
      report.strzelnica.push(sum);
    }
    if (cel.spawn) await ev(`(() => { clearInterval(window.__pdImmortal); const e = window.__pdTarget; if (e && !e.dead) { e.hp = 0; window.applyDamageToNPC?.(e, 1e9, 'test'); } return true; })()`);
    await sleep(1500);
  }
}

async function ttk() {
  const czas = Number(args.ttkCzas || 90);
  for (const [key, mode, color, dx] of [['destroyer', 'pirate', 'blue', -30000], ['destroyer', 'friendly', 'red', 30000]]) for (const pd of WARIANTY) {
    await ev(`(() => { window.rocketSystem3D.pdTargets = ${pd}; return true; })()`);
    const info = await spawnTarget(key, mode, dx, 20000);
    await sleep(2500);
    const w = 'grad_launcher';
    const t0 = await ev('window.SimClock?.sim ?? performance.now() / 1000');
    const hp0 = await ev(`(() => { const e = window.__pdTarget; return { hp: Math.round(e.hp), maxHp: Math.round(e.maxHp), tarcza: Math.round(e.shield?.val || 0) }; })()`);
    let salw = 0, dead = false;
    const icp0 = await ev(intercepted);
    const T0 = await ev('({ hits: window.__pdT.hits, fired: window.__pdT.fired })');
    const wall0 = Date.now();
    while (Date.now() - wall0 < czas * 1000) {
      const fired = await ev(`(() => {
        const t = window.__pdTarget, w = window.MASTER_WEAPONS.${w};
        if (!t || t.dead) return false;
        const tx = t.x, ty = t.y, a = 2.4;
        window.rocketSystem3D.fireSalvo(null, tx + Math.cos(a) * 5000, ty + Math.sin(a) * 5000, t, w.baseDamage, w, ${JSON.stringify(color)}, 0, 0, w.burstCount, w.burstDelay, a + Math.PI, 0);
        return true;
      })()`);
      if (!fired) { dead = true; break; }
      salw++;
      const tw = Date.now();
      while (Date.now() - tw < 9000) {
        await sleep(250);
        if (await ev('!window.__pdTarget || !!window.__pdTarget.dead')) { dead = true; break; }
      }
      if (dead) break;
    }
    const t1 = await ev('window.SimClock?.sim ?? performance.now() / 1000');
    const T1 = await ev('({ hits: window.__pdT.hits, fired: window.__pdT.fired })');
    const hp1 = await ev(`(() => { const e = window.__pdTarget; return e ? { hp: Math.round(e.hp), tarcza: Math.round(e.shield?.val || 0), dead: !!e.dead } : null; })()`);
    const rec = { cel: `${key}/${mode}`, pd, info, salw, zginal: dead, czasGry: +(t1 - t0).toFixed(1), hp0, hp1,
      rakiet: T1.fired - T0.fired, trafien: T1.hits - T0.hits, przechwycone: (await ev(intercepted)) - icp0 };
    console.log('TTK', JSON.stringify(rec));
    report.ttk.push(rec);
    await ev(`(() => { const e = window.__pdTarget; if (e && !e.dead) window.applyDamageToNPC?.(e, 1e9, 'test'); return true; })()`);
    await sleep(1500);
  }
}

async function fala() {
  const czas = Number(args.falaCzas || 40);
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=counter` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała (fala)');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła (fala)');
  if (!await waitFor(cdp, 'window.StoryGame.active && !!window.StoryGame.phase', 300000, 400)) throw new Error('fabuła nie ruszyła');
  await ev(TRACK);
  // --falaPd 0 — rakiety 3D bez obrony punktowej (stan sprzed 2026-10-12).
  await ev(`(() => { window.rocketSystem3D.pdTargets = ${args.falaPd !== '0'}; return true; })()`);
  await ev(`(() => { window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
    if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100); return true; })()`);
  const pick = `(() => { const T = window.__pdT; let onSide = 0; for (const [t, n] of T.hitsOn) if (t === window.ship || t?.friendly) onSide += n;
    return { wyrzucone: T.fired, wrogie: T.firedHostile, potomne: T.split, trafienia: T.hits, trafieniaStronyGracza: onSide, przechwycone: ${intercepted}, przez: ${interceptedBy},
      faza: window.StoryGame.phase, wrogowie: (window.npcs || []).filter((n) => window.isHostileNpc(n) && !n.dead).length }; })()`;
  const s0 = await ev(pick);
  for (let t = 10; t <= czas; t += 10) { await sleep(10000); console.log('fala', t, JSON.stringify(await ev(pick))); }
  const s1 = await ev(pick);
  report.fala = { czas, start: s0, koniec: s1 };
  console.log('FALA', JSON.stringify(report.fala));
}

try {
  if (TRYBY.includes('strzelnica') || TRYBY.includes('ttk')) {
    report.miejsce = await startFree();
    console.log('miejsce', JSON.stringify(report.miejsce));
    await ev(TRACK);
    if (TRYBY.includes('strzelnica')) await strzelnica();
    if (TRYBY.includes('ttk')) await ttk();
  }
  if (TRYBY.includes('fala')) await fala();
  report.bledy = logs.errors().slice(0, 60);
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
