// Zachowanie myśliwców w prawdziwej grze (2026-10-14, zgłoszenie: „jak biją statek, wpadają w szał”,
// „za szybko manewrują”, walka myśliwiec na myśliwca). Scenariusze w pustce między Wenus a Ziemią,
// Atlas nieśmiertelny, myśliwce i cele domyślnie nieśmiertelne (sam tor, bez strat — `--niesmiertelne 0` wyłącza):
//   atak   — eskadry gracza (start z hangarów Atlasa) na piracki pancernik ~4,5 km przed dziobem,
//   obrona — pirackie eskadry (przechwytujące, myśliwce) na Atlasa, bez myśliwców gracza,
//   kociol — eskadry gracza na pirackie eskadry (myśliwiec na myśliwca), bez okrętów,
//   role   — wezwane bombowce, torpedowce i kanonierki Terra Novy na piracki pancernik (miary per rola, bomby),
//   torpedy — same torpedowce na pancernik: los każdej torpedy (trafiona, w tarczę, zestrzelona, koniec zasięgu
//            z najmniejszą odległością od celu); `--celBezPd 1` — cel bez broni aux (A/B obrony punktowej).
// Sonda w npcStep (CDP Fetch, repo bez zmian) zapisuje KAŻDY krok fizyki każdego myśliwca: położenie, prędkość,
// kurs kadłuba, stan i podfazę mózgu, cel. Strzały — owinięty spawnBulletAdapter, trafienia — sondy w kolizjach pocisków
// i wiązek. Wynik: raport.json (prędkość, tempo skrętu wektora prędkości, przeciążenie boczne, obrót kadłuba, lot bokiem,
// zawrotki, zmiany stanów i celów, odległość od celu, czas nad kadłubem, strzały i trafienia), tory-<scen>.png
// (tory w układzie celu), <scen>-*.png (zrzuty).
//   node scripts/webgpu/mysliwce-zachowanie-gra.mjs [--scen atak,obrona,kociol,role,torpedy] [--czas 40]
//        [--niesmiertelne 1] [--celBezPd 0] [--zoom 0.22] [--port 5297] [--out katalog] [--tag nazwa]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { startVite, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome, screenshotPng } from './wspolne.mjs';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const SCEN = arg('scen', 'atak,obrona,kociol').split(',').map((s) => s.trim()).filter(Boolean);
const CZAS = Number(arg('czas', 40));
const NIESM = arg('niesmiertelne', '1') !== '0';
// --celBezPd 1 — cel (piracki pancernik) bez broni aux (obrona punktowa i flak) — A/B zestrzeleń torped i maszyn.
const CEL_BEZ_PD = arg('celBezPd', '0') === '1';
const ZOOM = Number(arg('zoom', 0.22));
const PORT = Number(arg('port', 5297));
const TAG = arg('tag', 'teraz');
const OUT = arg('out', join(tmpdir(), `mysliwce-zachowanie-${TAG}`));
mkdirSync(OUT, { recursive: true });

const F = 16; // liczb na próbkę
// [szukany fragment, zamiana] — każdy musi trafić dokładnie raz w skrypcie gry.
const SONDY = [
  ['function npcStep(dt, aiDbg = null, runAiMaintenance = true, brainDt = dt, brainPhase = 0, brainPhaseCount = 1) {',
    'function npcStep(dt, aiDbg = null, runAiMaintenance = true, brainDt = dt, brainPhase = 0, brainPhaseCount = 1) { if (window.__fp && window.__fp.on) window.__fp.sample(dt);'],
  ['applyDamageToPlayer(npcDamage * entryK.hp,', 'window.__fp.hit(b, hitNPC, 0), applyDamageToPlayer(npcDamage * entryK.hp,'],
  ['applyDamageToNPC(hitNPC, npcDamage * entryK.hp,', 'window.__fp.hit(b, hitNPC, 0), applyDamageToNPC(hitNPC, npcDamage * entryK.hp,'],
  ['registerShieldImpact(hitNPC, hitX, hitY, npcDamage, shieldFxClassForBullet(b));', 'window.__fp.hit(b, hitNPC, 1); registerShieldImpact(hitNPC, hitX, hitY, npcDamage, shieldFxClassForBullet(b));'],
  ['if (hitType === \'player\') applyPlayerDamage(damage, beamDmgOpts);', 'window.__fp.beamHit(shooter, hitEntity, beamHitShield); if (hitType === \'player\') applyPlayerDamage(damage, beamDmgOpts);'],
  ['function applyDamageToNPC(npc, dmg, cause = \'default\', opts = {}, byPlayer = false) {',
    'function applyDamageToNPC(npc, dmg, cause = \'default\', opts = {}, byPlayer = false) { if (window.__fpInvul && npc && npc.mission) return;'],
  // Obrona punktowa strąca rakietę / torpedę kanwy (los torped myśliwców).
  ['function killRocketThreat(rb, cause, fxScale, damage) {',
    'function killRocketThreat(rb, cause, fxScale, damage) { if (rb && rb.life > 0) rb.__fpKilled = cause || 1;']
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
    if (!body || !body.includes('function bulletsAndCollisionsStep')) return cdp.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
    const nl = body.includes('\r\n') ? '\r\n' : '\n';
    for (const [a, b] of SONDY) {
      const A = a.replace(/\n/g, nl);
      trafione[a.slice(0, 48)] = body.split(A).length - 1;
      body = body.split(A).join(b.replace(/\n/g, nl));
    }
    const headers = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding)$/i.test(h.name));
    await cdp.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: headers, body: Buffer.from(body, 'utf8').toString('base64') });
  })();
});
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*index.html*', resourceType: 'Script', requestStage: 'Response' }] });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); localStorage.setItem('sc_fog_of_war', '0'); } catch {}
  let s = 7;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  window.__fpInvul = ${NIESM ? 'true' : 'false'};
  const STATE = { guard: 0, engage_formation: 1, dogfight3D: 2, bombing: 3, strafe: 3, bomb_run: 4, torp_run: 5, orbit: 6, rearm: 7, rtb: 8 };
  const SUB = { merge: 1, slash: 2, core: 3, break_off: 4, pursuit: 5, overshoot: 6, defend: 7, in: 8, out: 9, turn: 10, setup: 11, break: 12 };
  const F = ${F};
  const isF = (n) => !!n && (n.fighter || n.type === 'fighter' || n.type === 'interceptor');
  const fp = window.__fp = {
    on: false, tick: 0, ox: 0, oy: 0,
    ids: new Map(), meta: [], tids: new WeakMap(), tidN: 0,
    data: new Float32Array(F * 600000), n: 0,
    shots: [], hits: [], beams: [],
    idOf(n) {
      let id = fp.ids.get(n);
      if (id === undefined) {
        id = fp.meta.length; fp.ids.set(n, id);
        fp.meta.push({ friendly: n.friendly === true, sq: n.squadronId || n.type, type: n.type, gun: n.gun, msl: n.msl,
          maxSpeed: n.maxSpeed, accel: n.accel, turn: n.turn, r: n.radius, role: n.fighterRole || null });
      }
      return id;
    },
    tidOf(t) { if (!t) return -1; let k = fp.tids.get(t); if (k === undefined) { k = ++fp.tidN; fp.tids.set(t, k); } return k; },
    kindOf(t) { if (!t) return 0; if (t === window.ship) return 3; return isF(t) ? 1 : 2; },
    reset() { fp.ids = new Map(); fp.meta = []; fp.tids = new WeakMap(); fp.tidN = 0; fp.n = 0; fp.tick = 0; fp.shots = []; fp.hits = []; fp.beams = [];
      fp.torps = new Map(); fp.torpStats = { odpalone: 0, trafione: 0, wTarcze: 0, zestrzelone: 0, zasieg: 0, inne: 0, minOdlChybionych: [] }; },
    // Los każdej torpedy myśliwca: trafienie (kadłub / tarcza), zestrzelenie przez obronę punktową, koniec zasięgu.
    torps: new Map(), torpStats: { odpalone: 0, trafione: 0, wTarcze: 0, zestrzelone: 0, zasieg: 0, inne: 0, minOdlChybionych: [] },
    trackTorps() {
      const list = window.bullets || [];
      const seen = fp.__seen || (fp.__seen = new Set());
      seen.clear();
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!b || b.type !== 'torpedo' || !isF(b.source)) continue;
        seen.add(b);
        let r = fp.torps.get(b);
        if (!r) { r = { minD: Infinity, target: b.target }; fp.torps.set(b, r); fp.torpStats.odpalone++; }
        const t = r.target;
        if (t) { const tx = t.pos ? t.pos.x : t.x, ty = t.pos ? t.pos.y : t.y; r.minD = Math.min(r.minD, Math.hypot(b.x - tx, b.y - ty)); }
      }
      for (const [b, r] of fp.torps) {
        if (seen.has(b)) continue;
        const S = fp.torpStats;
        if (b.__fpHit === 2) S.wTarcze++;
        else if (b.__fpHit) S.trafione++;
        else if (b.__fpKilled) S.zestrzelone++;
        else if (!(b.life > 0)) { S.zasieg++; S.minOdlChybionych.push(Math.round(r.minD)); }
        else S.inne++;
        fp.torps.delete(b);
      }
    },
    sample(dt) {
      fp.tick++;
      fp.trackTorps();
      const list = window.npcs; if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        if (!n || n.dead || !isF(n)) continue;
        if (fp.n + F > fp.data.length) return;
        const t = (n.forceTarget && !n.forceTarget.dead) ? n.forceTarget : (n.target && !n.target.dead ? n.target : null);
        const d = fp.data, o = fp.n;
        d[o] = fp.tick; d[o + 1] = fp.idOf(n);
        d[o + 2] = n.x - fp.ox; d[o + 3] = n.y - fp.oy; d[o + 4] = n.vx || 0; d[o + 5] = n.vy || 0; d[o + 6] = n.angle || 0;
        d[o + 7] = STATE[n.state] ?? 9; d[o + 8] = SUB[n.sub] ?? 0;
        d[o + 9] = fp.kindOf(t);
        if (t) {
          const tx = t.pos ? t.pos.x : t.x, ty = t.pos ? t.pos.y : t.y;
          d[o + 10] = tx - fp.ox; d[o + 11] = ty - fp.oy; d[o + 12] = t.angle || 0;
          d[o + 13] = t === window.ship ? (window.ship.radius || 300) : (t.radius || 50);
          d[o + 14] = fp.tidOf(t);
        } else { d[o + 10] = 0; d[o + 11] = 0; d[o + 12] = 0; d[o + 13] = 0; d[o + 14] = -1; }
        d[o + 15] = (t && !isF(t) && window.fighterOverHull) ? (window.fighterOverHull(t, n.x, n.y) ? 1 : 0) : 0;
        fp.n += F;
      }
    },
    hit(b, target, shield) {
      if (b && b.type === 'torpedo') b.__fpHit = shield ? 2 : 1;
      if (!fp.on || !b || !isF(b.source)) return;
      const t = target && (target._realEntity || target);
      fp.hits.push(fp.tick, fp.idOf(b.source), fp.kindOf(t), shield ? 1 : 0);
    },
    beamHit(shooter, target, shield) {
      if (!fp.on || !isF(shooter)) return;
      const t = target && (target._realEntity || target);
      fp.beams.push(fp.tick, fp.idOf(shooter), fp.kindOf(t), shield ? 1 : 0);
    }
  };
})();` });
const ev = (e) => evaluate(cdp, e);
const wyniki = { tag: TAG, niesmiertelne: NIESM, czas: CZAS, scen: {} };

function b64ToF32(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

async function pobierzProbki() {
  const n = await ev('window.__fp.n');
  const parts = [];
  const CH = F * 40000;
  for (let o = 0; o < n; o += CH) {
    const b64 = await ev(`(() => { const a = window.__fp.data.subarray(${o}, Math.min(window.__fp.n, ${o + CH}));
      const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; const C = 0x8000;
      for (let i = 0; i < u.length; i += C) s += String.fromCharCode.apply(null, u.subarray(i, i + C)); return btoa(s); })()`);
    parts.push(b64ToF32(b64));
  }
  const out = new Float32Array(n);
  let w = 0;
  for (const p of parts) { out.set(p, w); w += p.length; }
  return out;
}

// --- miary ---------------------------------------------------------------
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const pct = (arr, p) => { if (!arr.length) return NaN; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const mean = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
const r1 = (x) => Math.round(x * 10) / 10;

function miary(data, meta, physHz, gunRanges, shots, hits, beams, ograniczDo) {
  const DT = 1 / physHz;
  const tracks = new Map();
  for (let o = 0; o < data.length; o += F) {
    const id = data[o + 1];
    if (ograniczDo && !ograniczDo(meta[id])) continue;
    let tr = tracks.get(id);
    if (!tr) { tr = []; tracks.set(id, tr); }
    tr.push(o);
  }
  const W = Math.max(1, Math.round(0.1 * physHz)); // okno tempa: 0,1 s
  const speed = [], psiRate = [], latAcc = [], spriteRate = [], misalign = [], dist = [];
  let samples = 0, sideways = 0, backwards = 0, overHull = 0, inGun = 0, inGunSolution = 0, withTarget = 0;
  let stateChanges = 0, subChanges = 0, targetChanges = 0, reversals = 0, trackTime = 0;
  const stateTime = new Array(10).fill(0);
  const subTime = new Array(13).fill(0);
  for (const [id, tr] of tracks) {
    const m = meta[id];
    const gr = gunRanges[m.gun] || 1500;
    trackTime += tr.length * DT;
    let lastRevT = -1e9;
    for (let k = 0; k < tr.length; k++) {
      const o = tr[k];
      const vx = data[o + 4], vy = data[o + 5];
      const sp = Math.hypot(vx, vy);
      const psi = Math.atan2(vy, vx);
      const th = data[o + 6];
      samples++;
      speed.push(sp);
      stateTime[data[o + 7]] += DT;
      subTime[data[o + 8]] += DT;
      if (sp > 80) {
        const mis = Math.abs(wrap(th - psi));
        misalign.push(mis * 180 / Math.PI);
        if (mis > Math.PI / 4) sideways++;
        if (mis > Math.PI * 0.75) backwards++;
      }
      if (data[o + 9] > 0) {
        withTarget++;
        const dx = data[o + 10] - data[o + 2], dy = data[o + 11] - data[o + 3];
        const d = Math.hypot(dx, dy);
        dist.push(d);
        if (data[o + 15] > 0 || (data[o + 9] !== 1 && d < data[o + 13])) overHull++;
        if (d < gr) {
          inGun++;
          const diff = Math.abs(wrap(Math.atan2(dy, dx) - th));
          if (diff < 0.75) inGunSolution++;
        }
      }
      if (k > 0) {
        const p = tr[k - 1];
        if (data[p + 7] !== data[o + 7]) stateChanges++;
        if (data[p + 8] !== data[o + 8]) subChanges++;
        if (data[p + 14] !== data[o + 14] && data[p + 14] > 0 && data[o + 14] > 0) targetChanges++;
      }
      if (k >= W) {
        const p = tr[k - W];
        const dtw = (data[o] - data[p]) * DT;
        if (dtw > 0 && dtw < 0.3) {
          const sp0 = Math.hypot(data[p + 4], data[p + 5]);
          if (sp > 80 && sp0 > 80) {
            const dpsi = Math.abs(wrap(psi - Math.atan2(data[p + 5], data[p + 4]))) / dtw;
            psiRate.push(dpsi * 180 / Math.PI);
            latAcc.push(dpsi * (sp + sp0) * 0.5);
          }
          spriteRate.push(Math.abs(wrap(th - data[p + 6])) / dtw * 180 / Math.PI);
        }
      }
      // Zawrotka: kurs wektora prędkości obrócony o > 150° w ciągu 1,2 s (przerwa 1,2 s między zliczeniami).
      const tNow = data[o] * DT;
      if (sp > 80 && tNow - lastRevT > 1.2) {
        const back = Math.round(1.2 * physHz);
        for (let j = k - 1; j >= 0 && (data[o] - data[tr[j]]) <= back; j -= 3) {
          const q = tr[j];
          if (Math.hypot(data[q + 4], data[q + 5]) < 80) continue;
          if (Math.abs(wrap(psi - Math.atan2(data[q + 5], data[q + 4]))) > (150 * Math.PI / 180)) { reversals++; lastRevT = tNow; break; }
        }
      }
    }
  }
  const perMin = (x) => trackTime > 0 ? r1(x / (trackTime / 60)) : NaN;
  const nShots = { gun: 0, beam: 0, missile: 0 };
  const shotsByKind = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < shots.length; i += 4) {
    if (ograniczDo && !ograniczDo(meta[shots[i + 1]])) continue;
    const c = shots[i + 2]; if (c === 1) nShots.gun++; else if (c === 2) nShots.beam++; else nShots.missile++;
    shotsByKind[shots[i + 3]] = (shotsByKind[shots[i + 3]] || 0) + 1;
  }
  const hitsBy = { 1: 0, 2: 0, 3: 0, shield: 0 };
  for (const arr of [hits, beams]) for (let i = 0; i < arr.length; i += 4) {
    if (ograniczDo && !ograniczDo(meta[arr[i + 1]])) continue;
    hitsBy[arr[i + 2]] = (hitsBy[arr[i + 2]] || 0) + 1; if (arr[i + 3]) hitsBy.shield++;
  }
  const S = Math.max(1, samples);
  return {
    mysliwcow: tracks.size,
    czasTorow_s: r1(trackTime),
    predkosc: { srednia: Math.round(mean(speed)), p50: Math.round(pct(speed, 0.5)), p90: Math.round(pct(speed, 0.9)) },
    skretWektora_degS: { srednia: Math.round(mean(psiRate)), p50: Math.round(pct(psiRate, 0.5)), p90: Math.round(pct(psiRate, 0.9)), p99: Math.round(pct(psiRate, 0.99)) },
    przeciazenieBoczne_uS2: { p50: Math.round(pct(latAcc, 0.5)), p90: Math.round(pct(latAcc, 0.9)), p99: Math.round(pct(latAcc, 0.99)) },
    obrotKadluba_degS: { srednia: Math.round(mean(spriteRate)), p90: Math.round(pct(spriteRate, 0.9)), p99: Math.round(pct(spriteRate, 0.99)) },
    rozjazdKadlubPredkosc_deg: { p50: Math.round(pct(misalign, 0.5)), p90: Math.round(pct(misalign, 0.9)) },
    lotBokiem_proc: r1(100 * sideways / S), lotTylem_proc: r1(100 * backwards / S),
    zawrotkiNaMin: perMin(reversals),
    zmianyStanuNaMin: perMin(stateChanges), zmianyPodfazyNaMin: perMin(subChanges), zmianyCeluNaMin: perMin(targetChanges),
    czasStanow_proc: Object.fromEntries(['guard', 'dolot', 'kociol', 'przelot/nalot', 'bomb_run', 'torp_run', 'orbita', 'przezbrojenie', 'powrot', 'inne']
      .map((k, i) => [k, r1(100 * stateTime[i] / Math.max(1e-9, trackTime))]).filter(([, v]) => v > 0)),
    czasPodfaz_proc: Object.fromEntries(['-', 'merge', 'slash', 'core', 'break_off', 'pursuit', 'overshoot', 'defend', 'in', 'out', 'turn', 'setup', 'break']
      .map((k, i) => [k, r1(100 * subTime[i] / Math.max(1e-9, trackTime))]).filter(([k, v]) => k !== '-' && v > 0)),
    odlegloscOdCelu: { p10: Math.round(pct(dist, 0.1)), p50: Math.round(pct(dist, 0.5)), p90: Math.round(pct(dist, 0.9)) },
    nadKadlubemCelu_proc: r1(100 * overHull / Math.max(1, withTarget)),
    wZasieguDzialka_proc: r1(100 * inGun / Math.max(1, withTarget)),
    wRozwiazaniuOgnia_proc: r1(100 * inGunSolution / Math.max(1, withTarget)),
    strzaly: nShots, strzalyNaMysliwiecS: r1((nShots.gun + nShots.beam) / Math.max(1e-9, trackTime)),
    strzalyWg: { mysliwce: shotsByKind[1] || 0, okrety: shotsByKind[2] || 0, gracz: shotsByKind[3] || 0 },
    trafienia: { mysliwce: hitsBy[1] || 0, okrety: hitsBy[2] || 0, gracz: hitsBy[3] || 0, wTarcze: hitsBy.shield },
    celnosc_proc: r1(100 * ((hitsBy[1] || 0) + (hitsBy[2] || 0) + (hitsBy[3] || 0)) / Math.max(1, nShots.gun + nShots.beam + nShots.missile))
  };
}

// --- tory (PNG) ------------------------------------------------------------
function png(w, h, rgba) {
  const crcT = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); crcT[n] = c; }
  const crc = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = crcT[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Tory wybranych myśliwców w układzie ich celu (cel w środku, nieobrócony) przez `okno` s od `t0`.
function rysujTory(data, meta, physHz, file, { okno = 8, ile = 8, zakres = 4000, filtr = null, t0 = null } = {}) {
  const Wd = 900, Hd = 900;
  const img = new Uint8ClampedArray(Wd * Hd * 4);
  for (let i = 0; i < img.length; i += 4) { img[i] = 8; img[i + 1] = 10; img[i + 2] = 16; img[i + 3] = 255; }
  const px = (x, y) => [Wd / 2 + (x / zakres) * (Wd / 2), Hd / 2 + (y / zakres) * (Hd / 2)];
  const put = (x, y, c, a = 1) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= Wd || y >= Hd) return; const i = (y * Wd + x) * 4;
    img[i] = img[i] * (1 - a) + c[0] * a; img[i + 1] = img[i + 1] * (1 - a) + c[1] * a; img[i + 2] = img[i + 2] * (1 - a) + c[2] * a; };
  const line = (x0, y0, x1, y1, c, a) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let k = 0; k <= n; k++) put(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, c, a); };
  // siatka co 1000 j.
  for (let g = -zakres; g <= zakres; g += 1000) {
    const [gx] = px(g, 0); const [, gy] = px(0, g);
    for (let y = 0; y < Hd; y += 3) put(gx, y, [40, 46, 60]);
    for (let x = 0; x < Wd; x += 3) put(x, gy, [40, 46, 60]);
  }
  const tracks = new Map();
  for (let o = 0; o < data.length; o += F) {
    const id = data[o + 1];
    if (filtr && !filtr(meta[id], data, o)) continue;
    let tr = tracks.get(id); if (!tr) { tr = []; tracks.set(id, tr); } tr.push(o);
  }
  const ids = [...tracks.keys()].filter((id) => tracks.get(id).length > physHz * okno * 0.5).slice(0, ile);
  const colors = [[255, 120, 90], [120, 220, 255], [255, 220, 90], [150, 255, 140], [230, 140, 255], [255, 160, 200], [140, 170, 255], [255, 255, 255]];
  let rKolo = 0;
  ids.forEach((id, idx) => {
    const tr = tracks.get(id);
    const start = t0 == null ? data[tr[Math.floor(tr.length * 0.35)]] : t0;
    const c = colors[idx % colors.length];
    let prev = null;
    for (const o of tr) {
      if (data[o] < start || data[o] > start + okno * physHz) continue;
      if (data[o + 9] <= 0) { prev = null; continue; }
      rKolo = Math.max(rKolo, data[o + 13]);
      const [x, y] = px(data[o + 2] - data[o + 10], data[o + 3] - data[o + 11]);
      if (prev) line(prev[0], prev[1], x, y, c, 0.85);
      prev = [x, y];
    }
  });
  // cel: okrąg promienia celu
  if (rKolo > 0) for (let k = 0; k < 720; k++) { const a = k / 720 * Math.PI * 2; const [x, y] = px(Math.cos(a) * rKolo, Math.sin(a) * rKolo); put(x, y, [255, 80, 80]); }
  const [cx, cy] = px(0, 0); for (let k = -6; k <= 6; k++) { put(cx + k, cy, [255, 80, 80]); put(cx, cy + k, [255, 80, 80]); }
  writeFileSync(file, png(Wd, Hd, img));
  return { mysliwcow: ids.length, okno, zakres };
}

// --- scenariusze ---------------------------------------------------------
const SETUP = {
  atak: `(() => {
    window.launchMountedFighterSquadrons();
    window.__fpLaunchAt = performance.now();
    return { mysliwceGracza: window.SQUAD.list.length };
  })()`,
  atakCel: `(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const pos = { x: s.pos.x + c * 4500, y: s.pos.y + n * 4500 };
    const out = [].concat(window.spawnCallInShip('battleship', { mode: 'pirate', spawnPos: pos, pos, spawnAngle: a + Math.PI / 2 }) || []);
    if (${CEL_BEZ_PD ? 'true' : 'false'}) for (const e of out) { if (e.weapons) e.weapons.aux = []; e._weaponsInit = false; e.autoWeapons = undefined; }
    window.__fpTargets = out;
    const g = { r: 0, halfLen: 0, halfWid: 0, axis: 0 };
    const geom = out[0] && window.getFighterTargetGeom && window.getFighterTargetGeom(out[0], g) ? g : null;
    return { cel: out.map((e) => e.type + ' r=' + e.radius), geom };
  })()`,
  obrona: `(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = [];
    const put = (key, pos) => { for (const e of [].concat(window.spawnCallInShip(key, { mode: 'pirate', spawnPos: pos, pos, spawnAngle: a + Math.PI }) || [])) out.push(e); };
    put('interceptor', at(5500, -1800)); put('fighter', at(5500, 1800));
    return { piraci: out.length };
  })()`,
  kociol: `(() => {
    window.launchMountedFighterSquadrons();
    return { mysliwceGracza: window.SQUAD.list.length };
  })()`,
  // Role (2026-10-14): bombowce, torpedowce i kanonierki Terra Novy (wezwane — skrzydło wsparcia) na piracki pancernik.
  role: `(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = [];
    const put = (key, pos) => { for (const e of [].concat(window.spawnCallInShip(key, { mode: 'friendly', spawnPos: pos, pos, spawnAngle: a }) || [])) out.push(e); };
    put('bomber', at(-600, -1200)); put('torpedo_bomber', at(-600, 1200)); put('gunship', at(-900, 0));
    return { wezwane: out.length, role: out.map((e) => e.squadronId).join(',') };
  })()`,
  // Same torpedowce (2 eskadry Terra Novy) na piracki pancernik — los torped.
  torpedy: `(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = [];
    const put = (key, pos) => { for (const e of [].concat(window.spawnCallInShip(key, { mode: 'friendly', spawnPos: pos, pos, spawnAngle: a }) || [])) out.push(e); };
    put('torpedo_bomber', at(-600, -1200)); put('torpedo_bomber', at(-600, 1200));
    return { wezwane: out.length };
  })()`,
  kociolWrog: `(() => {
    const s = window.ship, a = s.angle, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = [];
    const put = (key, pos) => { for (const e of [].concat(window.spawnCallInShip(key, { mode: 'pirate', spawnPos: pos, pos, spawnAngle: a + Math.PI }) || [])) out.push(e); };
    put('interceptor', at(7000, -1200)); put('fighter', at(7500, 1200)); put('interceptor', at(8000, 0));
    return { piraci: out.length };
  })()`
};

async function wyczysc() {
  await ev(`(() => {
    for (const n of window.npcs || []) if (n && n.mission) { n.dead = true; }
    if (window.SQUAD) window.SQUAD.list = [];
    return true;
  })()`);
  await sleep(1200);
}

try {
  await navigateAndWait(cdp, `${base}/index.html?dev=1`, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  for (let t0 = Date.now(); Date.now() - t0 < 240000;) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30 && !!window.camera')) break; } catch { /* ładuje się */ }
  }
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
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    let hangars = window.getPlayerHangarTubes().length;
    if (!hangars) {
      const id = Object.keys(window.PlayerFit.presets).find((k) => window.PlayerFit.presets[k].start) || Object.keys(window.PlayerFit.presets)[0];
      window.Game.player.credits = 1e9;
      window.PlayerFit.apply(window.PlayerFit.plan(id, 'buy'));
      hangars = window.getPlayerHangarTubes().length;
    }
    // Strzały myśliwców: kategoria broni (1 działko, 2 wiązka, 3 rakieta) i rodzaj celu.
    const fp = window.__fp, orig = window.spawnBulletAdapter;
    window.spawnBulletAdapter = function (owner, target, def, opts) {
      if (fp.on && owner && (owner.fighter || owner.type === 'fighter' || owner.type === 'interceptor')) {
        const cat = def?.category === 'beam' ? 2 : ((def?.category === 'rocket' || def?.category === 'torpedo' || def?.category === 'bomb') ? 3 : 1);
        fp.shots.push(fp.tick, fp.idOf(owner), cat, fp.kindOf(target));
      }
      return orig.apply(this, arguments);
    };
    const W = window.MASTER_WEAPONS || {};
    const gunRanges = {}; for (const k of Object.keys(W)) gunRanges[k] = W[k].baseRange;
    return { hangars, physHz: window.PHYS_HZ, gunRanges, origin: { x: window.ship.pos.x, y: window.ship.pos.y } };
  })()`);
  const physHz = wyniki.start.physHz || 60;
  console.log('start', JSON.stringify({ hangars: wyniki.start.hangars, physHz }));

  for (const scen of SCEN) {
    await wyczysc();
    await ev(`(() => { const s = window.ship; window.__fp.reset(); window.__fp.ox = s.pos.x; window.__fp.oy = s.pos.y; window.__fp.on = true; return true; })()`);
    const setup = {};
    setup.a = await ev(SETUP[scen]);
    if (scen === 'atak') { await sleep(2500); setup.b = await ev(SETUP.atakCel); }
    if (scen === 'kociol') { await sleep(3500); setup.b = await ev(SETUP.kociolWrog); }
    if (scen === 'role' || scen === 'torpedy') { setup.b = await ev(SETUP.atakCel); }
    console.log(scen, JSON.stringify(setup));
    const zrzuty = [];
    for (let t = 0; t < CZAS; t += 1) {
      await sleep(1000);
      if (t === 9 || t === 15 || t === Math.floor(CZAS * 0.6)) {
        // Kadr na walce: atak i role — zbliżenie na cel (rysunki ról, bomby, wieżyczki), obrona — na Atlasa,
        // kocioł — środek ciężkości myśliwców; kamera RTS na chwilę zrzutu.
        const ok = await ev(`(() => {
          const fs = (window.npcs || []).filter((n) => n && !n.dead && (n.fighter || n.type === 'fighter' || n.type === 'interceptor'));
          if (!fs.length) return false;
          let sx = 0, sy = 0; for (const f of fs) { sx += f.x; sy += f.y; }
          let cx = sx / fs.length, cy = sy / fs.length, z = ${ZOOM * 1.6};
          const scen = ${JSON.stringify(scen)};
          const tgt = (window.__fpTargets || []).find((e) => e && !e.dead);
          if ((scen === 'atak' || scen === 'role') && tgt) { cx = tgt.x; cy = tgt.y; z = 0.9; }
          if (scen === 'obrona' && window.ship) { cx = window.ship.pos.x; cy = window.ship.pos.y; z = 0.55; }
          const cam = window.camera;
          if (cam.enterRtsMode) { try { cam.enterRtsMode(); } catch {} }
          cam.manualZoom = true; cam.zoom = cam.targetZoom = cam.zoomBase = z;
          cam.x = cam.targetX = cx; cam.y = cam.targetY = cy;
          return true;
        })()`);
        if (ok) {
          await sleep(300);
          const f = join(OUT, `${scen}-${t + 1}s.png`);
          await screenshotPng(cdp, f);
          zrzuty.push(f);
          await ev(`(() => { const cam = window.camera; if (cam.exitRtsMode) { try { cam.exitRtsMode(); } catch {} } cam.zoom = cam.targetZoom = cam.zoomBase = ${ZOOM}; return true; })()`);
        }
      }
    }
    await ev('window.__fp.on = false');
    const data = await pobierzProbki();
    const meta = await ev('window.__fp.meta');
    const shots = await ev('window.__fp.shots');
    const hits = await ev('window.__fp.hits');
    const beams = await ev('window.__fp.beams');
    const strony = {
      gracz: (m) => m.friendly,
      piraci: (m) => !m.friendly
    };
    const res = { setup, zrzuty, probek: data.length / F, torpedy: await ev('window.__fp.torpStats') };
    if (res.torpedy && res.torpedy.odpalone) console.log(scen, 'torpedy', JSON.stringify(res.torpedy));
    for (const [k, f] of Object.entries(strony)) {
      const m = miary(data, meta, physHz, wyniki.start.gunRanges, shots, hits, beams, f);
      if (m.mysliwcow) res[k] = m;
    }
    if (scen === 'role' || scen === 'torpedy') {
      for (const sq of ['bomber', 'torpedo', 'gunship']) {
        const m = miary(data, meta, physHz, wyniki.start.gunRanges, shots, hits, beams, (q) => q.friendly && q.sq === sq);
        if (m.mysliwcow) res[sq] = m;
        res['tory_' + sq] = rysujTory(data, meta, physHz, join(OUT, `tory-role-${sq}.png`), {
          okno: 10, ile: 4, zakres: 5000, filtr: (q) => q.friendly && q.sq === sq
        });
      }
      res.bomby = await ev('window.FighterBombs ? { ...(window.FighterBombs.stats || {}) } : null');
      wyniki.scen[scen] = res;
      console.log(scen, JSON.stringify({ bomber: res.bomber, torpedo: res.torpedo, gunship: res.gunship, bomby: res.bomby }, null, 1));
      continue;
    }
    // Tory: myśliwce gracza w atak / kocioł, piraci w obronie.
    const filtr = scen === 'obrona' ? ((m) => !m.friendly) : ((m) => m.friendly);
    res.tory = rysujTory(data, meta, physHz, join(OUT, `tory-${scen}.png`), {
      okno: 8, ile: 6, zakres: scen === 'kociol' ? 4500 : 4000, filtr
    });
    res.tory2 = rysujTory(data, meta, physHz, join(OUT, `tory-${scen}-1.png`), {
      okno: 3, ile: 1, zakres: scen === 'kociol' ? 3000 : 3000, filtr
    });
    wyniki.scen[scen] = res;
    console.log(scen, JSON.stringify({ gracz: res.gracz, piraci: res.piraci }, null, 1));
  }
} finally {
  wyniki.sondy = trafione;
  writeFileSync(join(OUT, 'raport.json'), JSON.stringify(wyniki, null, 1));
  console.log('sondy', JSON.stringify(trafione), '\nwyniki:', OUT);
  const errs = logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));
  if (errs.length) console.log('błędy:', errs.slice(0, 8));
  await chrome.close();
  await server.close();
}
