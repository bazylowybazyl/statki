// Demo mostków — benchmark bez renderu, deterministyczny (Node i przeglądarka).
//
// Dla kadłuba × broni × kierunku liczy:
//   A) ostrzał „lock na mostek” (celowanie w żywy heks mostka najbliższy
//      strzelcowi): ile pocisków do utraty dowodzenia, a ile do śmierci z puli
//      HP / sufitu heksów / utraty hardpointów przy TYM SAMYM ostrzale;
//   B) wyniszczenie: celowanie w środek kadłuba (z przejściem na najbliższy
//      żywy heks, gdy linia jest już przestrzelona), bez mostków.
// Tarcza zbita od startu (brief: „liczone od zbitej tarczy”), cel stoi.
// Czas = pociski × odstęp jednego działa (cooldown / salwa / lufy).
//
// MODEL TRAFIEŃ: domyślnie „sztywny” — deformacja wizualna nie wchodzi do
// geometrii trafień (nie wołamy updateVisuals). Powód: na ścieżce CPU (bez
// WebGPU, kadłub > 500 heksów) nic nie relaksuje wgnieceń, heks trafiany
// seriami ucieka o kilka komórek w głąb, sweepImpact dalej go znajduje, ale
// sonda applyImpact (okno ±3 komórki wokół punktu) już nie — i cała linia
// ognia przestaje zadawać obrażenia heksom (pula HP spada dalej). Z WebGPU
// sprężyny GPU rozpraszają wgniecenie; tego nie da się odtworzyć
// deterministycznie. cfg.visuals = true włącza ścieżkę CPU z artefaktem.
//
// Wyniki tego pliku NIE zależą od renderu: ten sam kod liczy w Node
// (dema/mostki-bench-node.js) i w demie (przycisk „Benchmark”).

import { DestructorSystem, DESTRUCTOR_CONFIG, disposeHexBody, getHexStructuralState } from '../src/game/destructor.js';
import {
  addCombatTarget,
  createCombatSim,
  fireInstant,
  PHYS_DT,
  resolveWeapon,
  stepVisuals,
  stepWorld
} from './mostki-sim.js';
import { attachHullBridges, bridgeVariants, defaultBridgeVariant } from './mostki-hulls.js';
import { evaluateShipBridges, getBridgeAimPoint, BRIDGE_EVENT } from '../src/game/shipBridge.js';

// Kąt strzelca względem osi dziobu (lokalnie): 0 = przed dziobem, π = za rufą.
export const BENCH_DIRECTIONS = Object.freeze({
  dziob: 0,
  skos: Math.PI / 4,
  burta: Math.PI / 2,
  rufa: Math.PI
});

export const BENCH_DIRECTION_LABELS = Object.freeze({ dziob: 'dziób', skos: 'skos 45°', burta: 'burta', rufa: 'rufa' });

export const BENCH_WEAPONS = Object.freeze([
  'heavy_autocannon',
  'railgun_mk2',
  'tempest_ion_l',
  'armata_mk1',
  'special_valkyrie_railgun',
  'beam_pulse',
  'beam_continuous',
  'siege_torpedo',
  'missile_rack'
]);

function withBenchConfig(run) {
  // GPU soft body (WebGPU) rwie heksy asynchronicznie — niedeterministycznie;
  // budżet czasu splitów zależy od zegara. Na czas benchmarku oba wyłączone.
  const saved = {
    gpuSoftBody: DESTRUCTOR_CONFIG.gpuSoftBody,
    splitTimeBudgetMs: DESTRUCTOR_CONFIG.splitTimeBudgetMs
  };
  const savedDebris = typeof window !== 'undefined' ? window.spawnGpuDebris : undefined;
  DESTRUCTOR_CONFIG.gpuSoftBody = 0;
  DESTRUCTOR_CONFIG.splitTimeBudgetMs = 1e9;
  if (typeof window !== 'undefined') window.spawnGpuDebris = null;
  try {
    return run();
  } finally {
    DESTRUCTOR_CONFIG.gpuSoftBody = saved.gpuSoftBody;
    DESTRUCTOR_CONFIG.splitTimeBudgetMs = saved.splitTimeBudgetMs;
    if (typeof window !== 'undefined') window.spawnGpuDebris = savedDebris;
  }
}

function resetDestructorGlobals() {
  DestructorSystem.splitQueue = [];
  DestructorSystem._tick = 0;
  DestructorSystem._simulationTime = 0;
  if (Array.isArray(DestructorSystem._wreckPool)) DestructorSystem._wreckPool.length = 0;
}

function disposeSim(sim) {
  for (const e of sim.entities) { try { disposeHexBody(e); } catch { /* już zwolnione */ } }
  sim.entities.length = 0;
}

const _aim = { x: 0, y: 0 };

// Model sztywny: wgniecenie od trafienia nie przesuwa heksa względem jego
// komórki (jakby sprężyny GPU prostowały blachę między strzałami). Bez tego
// natychmiastowa część applyDeformation (do 8 px na trafienie, bez sufitu
// sumy) wypycha heksy z okien detektorów i część linii ognia przestaje
// cokolwiek trafiać — patrz nagłówek.
function relaxDeformation(sim) {
  for (const e of sim.entities) {
    const shards = e?.hexGrid?.shards;
    if (!shards) continue;
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (s.deformation.x !== 0 || s.deformation.y !== 0) { s.deformation.x = 0; s.deformation.y = 0; }
      if (s.targetDeformation.x !== 0 || s.targetDeformation.y !== 0) { s.targetDeformation.x = 0; s.targetDeformation.y = 0; }
      s.__velX = 0; s.__velY = 0; s.__collVelX = 0; s.__collVelY = 0;
    }
  }
}

// Środek kadłuba; gdy linia strzału do środka jest już przestrzelona na wylot,
// najbliższy strzelcowi żywy heks (gracz przenosi celownik na resztę kadłuba).
function attritionAim(target, from, out, forceNearest = false) {
  out.x = target.x;
  out.y = target.y;
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (!forceNearest) {
    const hit = DestructorSystem.sweepImpact(target, from.x, from.y, target.x + dx * 2, target.y + dy * 2, 0);
    if (hit) return out;
  }
  const g = target.hexGrid;
  let best = null;
  let bestD2 = Infinity;
  const c = Math.cos(target.angle);
  const s = Math.sin(target.angle);
  for (const sh of g.shards) {
    if (!sh.active || sh.isDebris) continue;
    const lx = sh.gridX - g.srcWidth * 0.5;
    const ly = sh.gridY - g.srcHeight * 0.5;
    const wx = target.x + lx * c - ly * s;
    const wy = target.y + lx * s + ly * c;
    const d2 = (wx - from.x) ** 2 + (wy - from.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = { x: wx, y: wy }; }
  }
  if (best) { out.x = best.x; out.y = best.y; }
  return out;
}

/**
 * Jeden przypadek. cfg: { hullKey, weaponId, dir, mode: 'bridge'|'attrition',
 * bridges (lista stref), armorMul, killFrac, aim ('exposed'|'center'|'centroid'),
 * maxShots, seed, maxStepsPerShot }.
 */
export function runBenchCase(env, cfg) {
  return withBenchConfig(() => {
    resetDestructorGlobals();
    const sim = createCombatSim({ seed: cfg.seed || 1 });
    sim.bridgeKills = false;   // mostek nie zabija — mierzymy obie ścieżki do końca
    sim.fixHitProbe = cfg.fixHitProbe !== false;
    sim.poolHitMul = Number.isFinite(cfg.poolHitMul) ? cfg.poolHitMul : 1;
    const target = env.makeHull(cfg.hullKey);
    try {
      addCombatTarget(sim, target, { hullKey: cfg.hullKey, shield: false });
      const w = resolveWeapon(cfg.weaponId);
      const useBridge = cfg.mode === 'bridge';
      let st = null;
      if (useBridge) {
        const list = cfg.bridges || bridgeVariants(cfg.hullKey)[cfg.variant || defaultBridgeVariant(cfg.hullKey)];
        st = attachHullBridges(target, list, {
          windows: false,
          overrides: {
            ...(Number.isFinite(cfg.armorMul) ? { armorMul: cfg.armorMul } : {}),
            ...(Number.isFinite(cfg.killFrac) ? { killFrac: cfg.killFrac } : {})
          }
        });
      }
      const total = getHexStructuralState(target).total;
      const dirAngle = (BENCH_DIRECTIONS[cfg.dir] ?? 0) + (target.angle || 0);
      const dist = (target.radius || 400) + 900;
      const from = { x: target.x + Math.cos(dirAngle) * dist, y: target.y + Math.sin(dirAngle) * dist, vx: 0, vy: 0 };
      const perTrigger = Math.max(1, w.burst * w.barrels);
      const interval = w.cooldown / perTrigger;
      const stepsPerShot = Math.max(1, Math.min(cfg.maxStepsPerShot || 6, Math.round(interval / PHYS_DT)));
      const maxShots = cfg.maxShots || 3000;

      const rec = {
        hullKey: cfg.hullKey, weaponId: cfg.weaponId, dir: cfg.dir, mode: cfg.mode, variant: cfg.variant || null,
        aim: cfg.mode === 'bridge' ? (cfg.aim || 'breach') : 'center',
        armorMul: st ? st.bridges[0]?.def.armorMul : null, killFrac: st ? st.bridges[0]?.def.killFrac : null,
        bridgeHexes: st ? st.bridges.map((b) => b.total) : [],
        hexTotal: total,
        damagePerShot: w.damage,
        interval,
        bridge: null,       // { shots, time, damage, alive }
        pool: null,         // { shots, time, damage, alive, cause }
        shots: 0,
        misses: 0,
        hardpointsLost: 0,
        ceilingDamage: 0
      };

      let steps = 0;
      let lastMiss = false;
      const aimMemory = { shard: null, blockers: 0 };
      while (sim.stats.shots < maxShots) {
        let aim;
        if (useBridge && !st.commandLost) {
          aim = getBridgeAimPoint(target, _aim, { mode: cfg.aim || 'breach', fromX: from.x, fromY: from.y, memory: aimMemory }) || attritionAim(target, from, _aim, lastMiss);
        } else {
          // Pudło = linia przestrzelona na wylot (wiązka ma węższy test niż
          // sweep pocisku) — następny strzał w najbliższy żywy heks.
          aim = attritionAim(target, from, _aim, lastMiss);
        }
        const shot = fireInstant(sim, w, from, aim, null);
        // Pudło przestawia celowanie na najbliższy żywy heks na stałe
        // (gracz widzi dziurę na wylot i przenosi celownik).
        if (shot === 'miss') lastMiss = true;
        for (let k = 0; k < stepsPerShot; k++) {
          stepWorld(sim, PHYS_DT, { bullets: false });
          steps++;
          // Deformacja wizualna CPU (bez WebGPU) wciąga heksy poza okno sondy
          // applyImpact — patrz nagłówek i docs/PORT-mostki.md („heksy-duchy”).
          if (cfg.visuals && (steps & 1) === 0) stepVisuals(sim, PHYS_DT * 2);
        }
        if (!cfg.visuals) relaxDeformation(sim);
        // Dokładny moment (bez czekania na kadencję 0,08 s) — licznik strzałów.
        if (useBridge && !rec.bridge) {
          evaluateShipBridges(target, sim.time);
          if (st.commandLost) {
            rec.bridge = {
              shots: sim.stats.shots,
              time: sim.stats.shots * interval,
              damage: sim.stats.shots * w.damage,
              alive: getHexStructuralState(target).ratio
            };
          }
        }
        const c = target.combat;
        if (c.dead && !rec.pool) {
          rec.pool = {
            shots: c.killShot,
            time: c.killShot * interval,
            damage: c.killShot * w.damage,
            alive: c.aliveAtKill,
            cause: c.deathCause
          };
        }
        const doneBridge = !useBridge || rec.bridge;
        if (doneBridge && rec.pool) break;
        if (useBridge && rec.bridge && (cfg.stopAtBridge || w.kind === 'rocket3d')) break;
        if (w.kind === 'rocket3d' && rec.pool) break;
      }
      rec.shots = sim.stats.shots;
      rec.misses = sim.stats.misses;
      rec.probeMisses = sim.stats.probeMisses;
      rec.probeRescued = sim.stats.probeRescued;
      rec.fixHitProbe = sim.fixHitProbe;
      rec.poolHitMul = sim.poolHitMul;
      rec.hardpointsLost = target.combat.hardpointsLost;
      rec.ceilingDamage = Math.round(target.combat.ceilingDamage);
      rec.first = useBridge
        ? (rec.bridge && (!rec.pool || rec.bridge.shots <= rec.pool.shots) ? 'mostek' : (rec.pool ? 'pula' : 'brak'))
        : (rec.pool ? 'pula' : 'brak');
      return rec;
    } finally {
      disposeSim(sim);
    }
  });
}

/** Plan standardowy: wszystkie kadłuby × bronie × kierunki, obie metody. */
export function standardPlan(opts = {}) {
  const hulls = opts.hulls || ['battleship', 'pirate_battleship', 'atlas'];
  const weapons = opts.weapons || BENCH_WEAPONS;
  const dirs = opts.dirs || Object.keys(BENCH_DIRECTIONS);
  const plan = [];
  for (const hullKey of hulls) {
    const variants = hullKey === 'atlas' && opts.atlasVariants ? opts.atlasVariants : [defaultBridgeVariant(hullKey)];
    for (const weaponId of weapons) {
      for (const dir of dirs) {
        for (const variant of variants) {
          plan.push({ hullKey, weaponId, dir, mode: 'bridge', variant, armorMul: opts.armorMul, killFrac: opts.killFrac, seed: 7, maxShots: opts.maxShots || 3000, visuals: opts.visuals, fixHitProbe: opts.fixHitProbe, poolHitMul: opts.poolHitMul });
        }
        plan.push({ hullKey, weaponId, dir, mode: 'attrition', seed: 7, maxShots: opts.maxShots || 3000, visuals: opts.visuals, fixHitProbe: opts.fixHitProbe, poolHitMul: opts.poolHitMul });
      }
    }
  }
  return plan;
}

/** Czułość: siatka armorMul × killFrac dla jednej broni i kierunku. */
export function sensitivityPlan({ hullKey, weaponId = 'railgun_mk2', dir = 'burta', variant = null,
  armorMuls = [1, 2, 3, 4, 6], killFracs = [0.3, 0.45, 0.6, 0.75, 0.9], maxShots = 4000, fixHitProbe = true, poolHitMul = 1 } = {}) {
  const plan = [];
  for (const armorMul of armorMuls) {
    for (const killFrac of killFracs) {
      plan.push({ hullKey, weaponId, dir, mode: 'bridge', variant, armorMul, killFrac, seed: 7, maxShots, fixHitProbe, poolHitMul });
    }
  }
  return plan;
}

/** Uruchamia plan; `onProgress(i, n, rec)`; `pause()` — oddech dla przeglądarki. */
export async function runBenchPlan(env, plan, { onProgress = null, pause = null } = {}) {
  const out = [];
  for (let i = 0; i < plan.length; i++) {
    const rec = runBenchCase(env, plan[i]);
    out.push(rec);
    if (onProgress) onProgress(i + 1, plan.length, rec);
    if (pause) await pause();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raport
// ---------------------------------------------------------------------------

const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d).replace('.', ','));

function fmtTime(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  if (sec < 90) return `${fmt(sec, sec < 10 ? 1 : 0)} s`;
  return `${fmt(sec / 60, 1)} min`;
}

/** Łączy wiersze mostek/wyniszczenie w pary do tabeli. */
export function pairResults(rows) {
  const key = (r) => `${r.hullKey}|${r.weaponId}|${r.dir}`;
  const attr = new Map();
  for (const r of rows) if (r.mode === 'attrition') attr.set(key(r), r);
  const out = [];
  for (const r of rows) {
    if (r.mode !== 'bridge') continue;
    out.push({ bridgeRun: r, attrition: attr.get(key(r)) || null });
  }
  return out;
}

export function formatBenchMarkdown(rows, { title = 'Benchmark mostków', weaponNames = {} } = {}) {
  const lines = [`## ${title}`, ''];
  lines.push('Pociski do killa od zbitej tarczy (cel stoi, jedno działo). „Mostek” = lock na mostek; „pula” = śmierć z puli HP / sufitu heksów / hardpointów przy tym samym ostrzale; „wyniszczenie” = celowanie w środek kadłuba bez mostków. Łup = % heksów żywych w chwili killa.');
  lines.push('');
  lines.push('| kadłub | wariant | broń | kierunek | mostek: pociski | czas | łup | pula przy ostrzale mostka | pierwszy | wyniszczenie: pociski | czas | łup | zysk |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { bridgeRun: b, attrition: a } of pairResults(rows)) {
    const name = weaponNames[b.weaponId] || b.weaponId;
    const bShots = b.bridge ? b.bridge.shots : null;
    const aShots = a?.pool ? a.pool.shots : null;
    const gain = bShots && aShots ? `${fmt(aShots / bShots, 1)}×` : '—';
    lines.push(`| ${b.hullKey} | ${b.variant || '—'} | ${name} | ${BENCH_DIRECTION_LABELS[b.dir] || b.dir} | ${bShots ?? `>${b.shots}`} | ${fmtTime(b.bridge?.time)} | ${b.bridge ? fmt(b.bridge.alive * 100) + '%' : '—'} | ${b.pool ? b.pool.shots + ' (' + b.pool.cause + ')' : '—'} | ${b.first} | ${aShots ?? `>${a?.shots ?? '?'}`} | ${fmtTime(a?.pool?.time)} | ${a?.pool ? fmt(a.pool.alive * 100) + '%' : '—'} | ${gain} |`);
  }
  return lines.join('\n');
}

export function formatSensitivityMarkdown(rows, { title = 'Czułość' } = {}) {
  const muls = [...new Set(rows.map((r) => r.armorMul))].sort((a, b) => a - b);
  const fracs = [...new Set(rows.map((r) => r.killFrac))].sort((a, b) => a - b);
  const lines = [`### ${title}`, '', `| armorMul \\ killFrac | ${fracs.map((f) => fmt(f, 2)).join(' | ')} |`, `|---|${fracs.map(() => '---').join('|')}|`];
  for (const m of muls) {
    const cells = fracs.map((f) => {
      const r = rows.find((x) => x.armorMul === m && x.killFrac === f);
      if (!r) return '—';
      const b = r.bridge ? r.bridge.shots : `>${r.shots}`;
      const p = r.pool ? r.pool.shots : '—';
      return `${b} / ${p}${r.first === 'pula' ? ' ⚠' : ''}`;
    });
    lines.push(`| ${fmt(m, 1)} | ${cells.join(' | ')} |`);
  }
  lines.push('', 'Komórka: pociski do utraty dowodzenia / pociski do śmierci z puli przy tym samym ostrzale; ⚠ = pula zabija pierwsza.');
  return lines.join('\n');
}
