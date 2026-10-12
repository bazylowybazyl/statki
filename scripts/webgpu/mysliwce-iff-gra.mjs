// Ogień w swoich przy myśliwcach (2026-10-11, zgłoszenie: „moje myśliwce mnie biły, mój CIWS atakował moje myśliwce”).
// Prawdziwa gra: Atlas z hangarami w pustce, start eskadr (Z = launchMountedFighterSquadrons), pirackie myśliwce i fregaty
// ~5 km przed dziobem; potem kaskada reputacji (Terra Nova → „Wrogi”). Sondy wstrzyknięte w podawany skrypt gry
// (CDP Fetch, repo bez zmian) liczą: trafienia gracza i sojuszników strzałami strony gracza, cele CIWS / laseru PD / flaku
// i kandydatów wież na auto ze strony gracza, trafienia gracza przez piratów i straty pirackich myśliwców.
//   node scripts/webgpu/mysliwce-iff-gra.mjs [--przed 1] [--czas 60] [--port 5296] [--out katalog]
// --przed 1 — podawany kod bez poprawki (IFF i myśliwce poza frakcjami wycięte w locie) — A/B tym samym harnessem.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome, screenshotPng } from './wspolne.mjs';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const PRZED = arg('przed', '0') === '1';
// --karta missile — karta RAKIETOWIEC (eskadry „strike” z rakietami 3D fast_missile_rack); domyślnie karta startowa (multirole).
const KARTA = arg('karta', '');
const CZAS = Number(arg('czas', 60));
const PORT = Number(arg('port', 5296));
const OUT = arg('out', join(tmpdir(), `mysliwce-iff-${PRZED ? 'przed' : 'po'}`));
mkdirSync(OUT, { recursive: true });

// Sondy: [szukany fragment, zamiana]. Każda musi trafić dokładnie raz w skrypcie gry.
const SONDY = [
  ['applyDamageToPlayer(npcDamage * entryK.hp,', 'window.__ff.hit(b, hitNPC, npcDamage * entryK.hp), applyDamageToPlayer(npcDamage * entryK.hp,'],
  ['applyDamageToNPC(hitNPC, npcDamage * entryK.hp,', 'window.__ff.hit(b, hitNPC, npcDamage * entryK.hp), applyDamageToNPC(hitNPC, npcDamage * entryK.hp,'],
  ['registerShieldImpact(hitNPC, hitX, hitY, npcDamage, shieldFxClassForBullet(b));', 'window.__ff.hit(b, hitNPC, npcDamage); registerShieldImpact(hitNPC, hitX, hitY, npcDamage, shieldFxClassForBullet(b));'],
  ['if (hitType === \'player\') applyPlayerDamage(damage, beamDmgOpts);', 'window.__ff.beam(shooter, hitEntity, damage); if (hitType === \'player\') applyPlayerDamage(damage, beamDmgOpts);'],
  ['        if (!target) continue;\n        const dist = Math.sqrt(bestDistSq);', '        if (!target) continue;\n        window.__ff.pd(target, isFlak, isLaser);\n        const dist = Math.sqrt(bestDistSq);'],
  ['        put(e, -1);\n      };', '        window.__ff.fc(e); put(e, -1);\n      };'],
  ['        const target = hit.entity;\n        if (target._isPlayerShip) {', '        const target = hit.entity;\n        window.__ff.flak(b, target, hit.damage);\n        if (target._isPlayerShip) {'],
  ['window.changePlayerReputation = changePlayerReputation;', 'window.changePlayerReputation = changePlayerReputation; window.__ffPLAYER = PLAYER;']
];
const BEZ_POPRAWKI = [
  ['if (projectilePassesAlly(b, npc)) continue;', ''],
  ['if (beamPassesAlly(shooter, pt, playerShip)) continue;', ''],
  ['if (entity.playerOwned) return null;', '']
];

const { server, base } = await startVite(PORT);
const chrome = await startChrome({ width: 1600, height: 900 });
const { cdp, logs } = chrome;
const trafione = {};
cdp.on((msg) => {
  if (msg.method !== 'Fetch.requestPaused') return;
  const p = msg.params;
  (async () => {
    let body = null;
    try {
      const r = await cdp.send('Fetch.getResponseBody', { requestId: p.requestId });
      body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body;
    } catch { body = null; }
    // Rakiety 3D (rocketSystem3D.js): --przed — filtr strony myśliwca wyłączony w locie.
    if (body && PRZED && body.includes('class RocketSystem3D')) {
      const before = body;
      body = body.replace(/import\s*\{\s*fighterSideOf,\s*fighterSideSparesAlly\s*\}\s*from\s*("[^"]+"|'[^']+');?/, 'import { fighterSideOf } from $1; const fighterSideSparesAlly = () => false;');
      trafione.rakietyBezFiltra = before === body ? 0 : 1;
      const headers = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
      return cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(body, 'utf8').toString('base64') });
    }
    if (!body || !body.includes('function bulletsAndCollisionsStep')) return cdp.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    const nl = body.includes('\r\n') ? '\r\n' : '\n';
    for (const [a, b] of [...SONDY, ...(PRZED ? BEZ_POPRAWKI : [])]) {
      const A = a.replace(/\n/g, nl);
      const n = body.split(A).length - 1;
      trafione[a.slice(0, 40)] = n;
      body = body.split(A).join(b.replace(/\n/g, nl));
    }
    const headers = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
    await cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(body, 'utf8').toString('base64') });
  })();
});
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*index.html*', resourceType: 'Script', requestStage: 'Response' },
  { urlPattern: '*rocketSystem3D.js*', resourceType: 'Script', requestStage: 'Response' }] });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_fog_of_war', '0'); } catch {}
  let s = 11;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // Liczniki. Strona strzału: pocisk — owner/source, wiązka — strzelec.
  const side = (e) => !!e && (e === window.ship || e._isPlayerShip || e.friendly === true);
  const isFighter = (e) => !!e && (e.fighter || e.type === 'fighter' || e.type === 'interceptor');
  const z = () => ({ n: 0, dmg: 0 });
  const C = window.__ff = {
    on: false,
    s: { graczOdSwoichMysliwcow: z(), graczOdCiwsGracza: z(), sojusznicyOdMysliwcowGracza: z(), mysliwceGraczaOdCiwsGracza: z(),
      mysliwceGraczaOdFlakuGracza: z(), graczOdPiratow: z(), graczOdRakietMysliwcow: z(), sojusznicyOdRakietMysliwcow: z(), piraciOdRakietMysliwcow: z(), piraciOdMysliwcowGracza: z(), piraciOdPdGracza: z(),
      celPdNaSwojMysliwiec: 0, celPdNaWrogiMysliwiec: 0, celPdRakieta: 0, kandydatWiezySwoj: 0, kandydatWiezyWrog: 0 },
    add(k, d) { const r = C.s[k]; r.n++; r.dmg += Number(d) || 0; },
    hit(b, target, dmg) {
      if (!C.on) return;
      const t = target._realEntity || target;
      const src = b.source;
      const friendlyShot = b.owner === 'player' || b.owner === 'player2' || src?.friendly === true;
      const isPlayer = t === window.ship;
      if (friendlyShot && isFighter(src) && src.friendly === true) {
        if (isPlayer) C.add('graczOdSwoichMysliwcow', dmg);
        else if (t.friendly === true) C.add('sojusznicyOdMysliwcowGracza', dmg);
        else if (t.isPirate) C.add('piraciOdMysliwcowGracza', dmg);
      } else if (src === window.ship && b.type === 'ciws') {
        if (isPlayer) C.add('graczOdCiwsGracza', dmg);
        else if (window.SQUAD?.list?.includes(t)) C.add('mysliwceGraczaOdCiwsGracza', dmg);
        else if (t.isPirate) C.add('piraciOdPdGracza', dmg);
      } else if (!friendlyShot && isPlayer) C.add('graczOdPiratow', dmg);
    },
    beam(shooter, target, dmg) {
      if (!C.on || !shooter || !target) return;
      const t = target._realEntity || target;
      if (isFighter(shooter) && shooter.friendly === true) {
        if (t === window.ship) C.add('graczOdSwoichMysliwcow', dmg);
        else if (t.friendly === true) C.add('sojusznicyOdMysliwcowGracza', dmg);
      } else if (!side(shooter) && t === window.ship) C.add('graczOdPiratow', dmg);
    },
    pd(target, isFlak, isLaser) {
      if (!C.on) return;
      if (target.type === 'rocket' || target.type === 'torpedo') C.s.celPdRakieta++;
      else if (window.SQUAD?.list?.includes(target)) C.s.celPdNaSwojMysliwiec++;
      else if (isFighter(target)) C.s.celPdNaWrogiMysliwiec++;
    },
    fc(e) { if (!C.on) return; if (window.SQUAD?.list?.includes(e) || e.friendly === true) C.s.kandydatWiezySwoj++; else C.s.kandydatWiezyWrog++; },
    flak(b, target, dmg) {
      if (!C.on) return;
      const t = target._realEntity || target;
      if (b.source === window.ship && window.SQUAD?.list?.includes(t)) C.add('mysliwceGraczaOdFlakuGracza', dmg);
      else if (b.source === window.ship && t.isPirate) C.add('piraciOdPdGracza', dmg);
    }
  };
})();` });
const ev = (e) => evaluate(cdp, e);
const wyniki = { przed: PRZED, sondy: trafione };

try {
  await navigateAndWait(cdp, `${base}/index.html?dev=1`, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  for (let t0 = Date.now(); Date.now() - t0 < 240000;) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30 && !!window.camera')) break; } catch { /* ładuje się */ }
  }
  // Pusta przestrzeń między Wenus a Ziemią (jak formacje-gra.mjs); gracz nie ginie (pancerz uzupełniany — sondy liczą przed).
  wyniki.start = await ev(`(() => {
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin };
    }
    window.DevScene.teleport(best.x, best.y, -Math.PI / 2); window.DevScene.syncCamera();
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 250);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = 0.12;
    let hangars = window.getPlayerHangarTubes().length;
    if (${JSON.stringify(KARTA)}) {
      window.__ffPLAYER.credits = 1e9;
      window.PlayerFit.apply(window.PlayerFit.plan(${JSON.stringify(KARTA)}, 'buy'));
      hangars = window.getPlayerHangarTubes().length;
    }
    if (!hangars) {
      const id = Object.keys(window.PlayerFit.presets).find((k) => window.PlayerFit.presets[k].start) || Object.keys(window.PlayerFit.presets)[0];
      window.Game.player.credits = 1e9;
      window.PlayerFit.apply(window.PlayerFit.plan(id, 'buy'));
      hangars = window.getPlayerHangarTubes().length;
    }
    return { hangars, rep: { ...window.__ffPLAYER.reputation } };
  })()`);
  console.log('start', JSON.stringify(wyniki.start));
  await ev(`(() => { window.launchMountedFighterSquadrons(); return true; })()`);
  await sleep(5000);
  // Piraci ~5 km przed dziobem: eskadry przechwytujących i myśliwców + 2 fregaty PD.
  wyniki.piraci = await ev(`(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = [];
    const put = (key, pos) => { for (const e of [].concat(window.spawnCallInShip(key, { mode: 'pirate', spawnPos: pos, pos, spawnAngle: a + Math.PI }) || [])) out.push(e); };
    put('interceptor', at(5000, -1500)); put('fighter', at(5500, 1500)); put('interceptor', at(6500, 0));
    put('frigate_pd', at(7000, -2500)); put('frigate_pd', at(7000, 2500));
    window.__pirFighters = out.filter((e) => e.fighter);
    return { n: out.length, mysliwce: window.__pirFighters.length, mysliwceGracza: window.SQUAD.list.length };
  })()`);
  console.log('piraci', JSON.stringify(wyniki.piraci));
  // Rakiety 3D myśliwców: trafienie głowicy i wybuch przez window.applyDamageTo* — strona z rakiety w trakcie wywołania
  // (fast_missile_rack niosą tylko eskadry strike tej sceny; r.hostile = barwa strony przy wyrzucie).
  wyniki.rakiety = await ev(`(() => {
    const RS = window.rocketSystem3D; if (!RS) return 'brak rocketSystem3D';
    const proto = Object.getPrototypeOf(RS); let cur = null;
    for (const m of ['_onHit', '_applyBlastDamage']) { const f = proto[m]; proto[m] = function (r, ...a) { cur = r; try { return f.call(this, r, ...a); } finally { cur = null; } }; }
    const wrap = (name, isPlayer) => { const f = window[name]; window[name] = function (...a) {
      const r = cur, C = window.__ff;
      if (C.on && r && r.weaponDef?.id === 'fast_missile_rack' && !r.hostile) {
        const t = isPlayer ? window.ship : a[0]; const d = isPlayer ? a[0] : a[1];
        if (isPlayer) C.add('graczOdRakietMysliwcow', d); else if (t?.friendly === true) C.add('sojusznicyOdRakietMysliwcow', d); else if (t?.isPirate) C.add('piraciOdRakietMysliwcow', d);
      }
      return f.apply(this, a); }; };
    wrap('applyDamageToPlayer', true); wrap('applyDamageToNPC', false);
    return 'ok';
  })()`);
  await ev('window.__ff.on = true');
  for (let t = 0; t < CZAS; t += 10) {
    await sleep(10000);
    const m = await ev(`({ t: ${t + 10}, ...JSON.parse(JSON.stringify(window.__ff.s)),
      swoiZywi: window.SQUAD.list.filter((f) => !f.dead).length, swoiWrodzy: window.SQUAD.list.filter((f) => !f.dead && f.friendly !== true).length,
      piraciMysliwceZywi: window.__pirFighters.filter((f) => !f.dead).length, repTN: window.__ffPLAYER.reputation.terra_nova })`);
    console.log(JSON.stringify(m));
    if (t === 10) await screenshotPng(cdp, join(OUT, 'walka.png'));
    wyniki.walka = m;
  }
  // Kaskada reputacji: Terra Nova „Wrogi” (np. po stratach od własnego ognia). Myśliwce gracza mają zostać jego.
  await ev(`(() => { window.__ff.on = false; for (const k in window.__ff.s) window.__ff.s[k] = typeof window.__ff.s[k] === 'number' ? 0 : { n: 0, dmg: 0 };
    window.launchMountedFighterSquadrons(); return true; })()`);
  await sleep(4000);
  await ev(`(() => { window.changePlayerReputation('terra_nova', -80, 'test'); window.__ff.on = true; return true; })()`);
  await sleep(15000);
  wyniki.kaskada = await ev(`({ ...JSON.parse(JSON.stringify(window.__ff.s)), repTN: window.__ffPLAYER.reputation.terra_nova,
    swoiZywi: window.SQUAD.list.filter((f) => !f.dead).length, swoiWrodzy: window.SQUAD.list.filter((f) => !f.dead && f.friendly !== true).length,
    swoiCelujaWGracza: window.SQUAD.list.filter((f) => !f.dead && f.target === window.ship).length })`);
  console.log('kaskada', JSON.stringify(wyniki.kaskada));
} finally {
  wyniki.sondy = trafione;
  writeFileSync(join(OUT, 'wyniki.json'), JSON.stringify(wyniki, null, 1));
  console.log('sondy', JSON.stringify(trafione), '\nwyniki:', OUT);
  const errs = logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));
  if (errs.length) console.log('błędy:', errs.slice(0, 8));
  await chrome.close();
  await server.close();
}
