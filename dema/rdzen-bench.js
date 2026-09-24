// Benchmark rdzenia — deterministyczny, bez renderu. Wspólny dla node
// (dema/rdzen-bench-node.js) i przeglądarki (przycisk w demie).
//
// Przypadek = kadłub × broń × kierunek. Działo stoi poza kadłubem na linii
// do rdzenia („lock na rdzeń”), strzela co przeładowanie z rozrzutem broni
// (salwy wielolufowe co SALVO_STEP), fizyka w kroku 1/120 jak w grze:
//   pociski/wiązki/rakiety → DestructorSystem.update → co 3. krok integralność
//   (rdzenie + sufit heksów), updateVisuals co 2. krok (60 Hz).
// Tarcza zbita od startu (liczymy od zbitej tarczy). Zabicie z puli HP NIE
// kończy przebiegu — mierzymy oba progi na tej samej serii strzałów:
//   kill przez rdzeń  = wejście w STOPIENIE (punkt bez powrotu),
//   kill przez wyniszczenie = pula HP albo sufit heksów, co pierwsze.
import { DestructorSystem, DESTRUCTOR_CONFIG, disposeHexBody } from '../src/game/destructor.js';
import { createCpuSoftBody } from './rdzen-softbody-cpu.js';
import { stepDecay120 } from '../src/game/stepDecay.js';
import {
  attachShipCores,
  updateShipCores,
  getCoreWorld,
  CORE_STATE,
  CORE_KILL_MODE
} from '../src/game/shipCore.js';
import {
  fireWeapon,
  planTrigger,
  stepBullets,
  stepRockets3D,
  enforceHexCap,
  weaponDef,
  isRocket3D,
  makeRng,
  entityX,
  entityY,
  applyProbeMode,
  GAME_HAS_DRIFT_PROBES
} from './rdzen-combat.js';
import { HULLS } from './rdzen-hulls-data.js';

export const PHYS_DT = 1 / 120;

// Broń: co najmniej działko, rail, ciężkie działo/special, wiązka, rakieta/torpeda.
export const BENCH_WEAPONS = Object.freeze([
  'vulcan_minigun',
  'heavy_autocannon',
  'railgun_mk2',
  'tempest_ion_l',
  'helios_laser',
  'armata_mk1',
  'special_valkyrie_railgun',
  'special_yamato_cannon',
  'beam_continuous',
  'beam_pulse',
  'siege_torpedo',
  'missile_rack'
]);

// Kierunek = skąd przychodzi ogień (kąt od dziobu, +X kadłuba).
export const BENCH_DIRECTIONS = Object.freeze({ bow: 0, oblique: 45, side: 90, stern: 180 });
export const DIRECTION_LABEL = Object.freeze({ bow: 'dziób', oblique: 'skos', side: 'burta', stern: 'rufa' });

export const BENCH_DEFAULTS = Object.freeze({
  distance: 2500,        // j. świata od rdzenia (ograniczone do 80% zasięgu broni)
  maxTime: 300,          // s symulacji na przypadek
  killMode: CORE_KILL_MODE.CONTAINMENT,
  seed: 1337
});

function coreMarkersFor(hullId, override) {
  const def = HULLS[hullId];
  if (Array.isArray(override)) return override;
  return (def.cores || []).map((c) => ({ ...c }));
}

/**
 * @param {object} opts
 *   buildHull(hullId, {x,y,angle,noSplit}) → encja z hexGrid (node lub przeglądarka)
 *   hullId, weaponId, direction (klucz BENCH_DIRECTIONS albo kąt w stopniach)
 *   markers?, killMode?, distance?, maxTime?, seed?, spreadMul?, coreConfig?
 */
export function runCoreBenchmarkCase(opts) {
  const {
    buildHull, hullId, weaponId,
    direction = 'side',
    killMode = BENCH_DEFAULTS.killMode,
    maxTime = BENCH_DEFAULTS.maxTime,
    seed = BENCH_DEFAULTS.seed,
    spreadMul = 1,
    // 'cpu' = lustro solvera sprężyn GPU (tak rwie heksy gra z WebGPU),
    // 'none' = sama ścieżka CPU destruktora (dolna granica zniszczeń).
    softBody = 'cpu',
    // A/B sprzed poprawki heksów-duchów (dawne okna sond, solver co klatkę).
    legacyProbes = false,
    // Moje dawne przybliżenie poprawki — działa tylko na destruktorze bez
    // probeDriftCap (od poprawki w grze to jej domyślne zachowanie).
    driftAwareProbes = false,
    // 'chamber' = lock na rdzeń celuje w losowy punkt komory (podsystem, nie
    // piksel), 'point' = zawsze w sam punkt rdzenia.
    aimMode = 'chamber',
    extrapolateAttrition = true
  } = opts;
  const def = HULLS[hullId];
  const weapon = weaponDef(weaponId);
  if (!def || !weapon) throw new Error(`benchmark: ${hullId}/${weaponId}`);
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  DestructorSystem.splitQueue = [];

  const hull = buildHull(hullId, { x: 0, y: 0, angle: 0, noSplit: false });
  const cores = attachShipCores(hull, coreMarkersFor(hullId, opts.markers), {
    pngWidth: def.pngWidth, pngHeight: def.pngHeight, killMode, config: opts.coreConfig || null
  });
  const core = cores[0];
  if (!core || core.invalid) {
    disposeHexBody(hull);
    return { hullId, weaponId, direction, error: core?.invalid || 'brak-rdzenia' };
  }
  if (hull.shield) hull.shield.val = 0;
  const hp0 = hull.isPlayer ? hull.hull.max : hull.maxHp;
  const hexTotal = hull.hexGrid.shards.length;

  const coreW = getCoreWorld(core, {});
  const angleDeg = typeof direction === 'number' ? direction : (BENCH_DIRECTIONS[direction] ?? 90);
  const a = angleDeg * Math.PI / 180;
  const distance = Math.min(Number(opts.distance) || BENCH_DEFAULTS.distance, (weapon.baseRange || 5000) * 0.8);
  const gun = { x: coreW.x + Math.cos(a) * distance, y: coreW.y + Math.sin(a) * distance, source: { shipFrame: 'atlas', __benchGun: true } };
  const aimPoint = { x: coreW.x, y: coreW.y, dead: false, radius: 0 };

  const entities = [hull];
  const rng = makeRng(seed);
  const stats = {};
  const result = {
    hullId, weaponId, direction, killMode, distance, softBody, driftAwareProbes, aimMode,
    probeMode: legacyProbes ? 'legacy' : (GAME_HAS_DRIFT_PROBES ? 'game' : (driftAwareProbes ? 'wide' : 'game-old')),
    coreId: core.id, chamberHexes: core.chamber.length, armorMul: core.armorMul, chamberR: core.gridR,
    hexTotal, hp0,
    core: null, attrition: null, exposed: null, critical: null,
    shots: 0, projectiles: 0, simTime: 0, timedOut: false
  };
  let attritionAt = null;
  const hooks = {
    onKilled(entity, cause) {
      if (entity !== hull || attritionAt) return;
      attritionAt = { cause, time: 0 };
    }
  };
  const origSpread = weapon.spread;
  const ctx = {
    bullets: [], rockets: [], targets: entities, rng, hooks, stats, primary: hull,
    homingTarget: aimPoint, rocketTarget: hull, driftAwareProbes, legacyProbes
  };
  const restoreProbes = applyProbeMode(legacyProbes ? 'legacy' : (driftAwareProbes ? 'wide' : 'game'));

  const cpuSoft = softBody === 'cpu' ? createCpuSoftBody() : null;
  const aimRng = makeRng((seed * 7919) >>> 0);
  const _aimScratch = { x: 0, y: 0 };
  const cooldown = Math.max(0.02, weapon.cooldown || 1);
  const salvo = planTrigger(weaponId);
  const pending = [];
  let nextTrigger = 0;
  let time = 0;
  let step = 0;
  let integrityAcc = 0;
  const snap = () => ({
    time: +time.toFixed(3),
    shots: result.shots,
    projectiles: result.projectiles,
    hits: stats.primaryHits || 0,
    damage: Math.round(stats.primaryDamage || 0),
    hexesLost: hexTotal - (hull.hexGrid?.activeStructuralCount ?? hexTotal),
    integrity: +core.integrity.toFixed(3),
    chamberDead: core.deadCount
  });

  // Rozrzut ×spreadMul (np. 0 = idealne celowanie) bez ruszania katalogu broni.
  let spreadPatched = false;
  if (spreadMul !== 1 && Number.isFinite(spreadMul)) {
    weapon.spread = (origSpread || 0) * spreadMul;
    spreadPatched = true;
  }
  try {
    while (time < maxTime) {
      if (time + 1e-9 >= nextTrigger) {
        result.shots++;
        for (const delay of salvo) pending.push(time + delay);
        nextTrigger += cooldown;
      }
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i] > time + 1e-9) continue;
        pending.splice(i, 1);
        let ax = aimPoint.x, ay = aimPoint.y;
        if (aimMode === 'chamber' && core.host === hull) {
          const cw = getCoreWorld(core, _aimScratch);
          const rr = core.gridR * Math.sqrt(aimRng());
          const aa = aimRng() * Math.PI * 2;
          ax = cw.x + Math.cos(aa) * rr;
          ay = cw.y + Math.sin(aa) * rr;
        }
        const fired = fireWeapon(ctx, gun, weaponId, ax, ay);
        result.projectiles += (fired?.bullets || 0) + (fired?.rockets || 0) + (fired?.beam ? 1 : 0);
      }
      stepBullets(ctx, PHYS_DT);
      stepRockets3D(ctx, PHYS_DT);
      DestructorSystem.update(PHYS_DT, entities);
      for (const e of entities) {
        if (!e.isWreck || e.dead) continue;
        e.x += (e.vx || 0) * PHYS_DT;
        e.y += (e.vy || 0) * PHYS_DT;
        e.angle = (e.angle || 0) + (e.angVel || 0) * PHYS_DT;
        const k = stepDecay120(e.friction || 0.9986, PHYS_DT);
        e.vx *= k; e.vy *= k;
      }
      step++;
      time += PHYS_DT;
      integrityAcc += PHYS_DT;
      if (step % 3 === 0) {
        const events = updateShipCores(hull, integrityAcc, { time, entities });
        integrityAcc = 0;
        enforceHexCap(hull, hooks);
        for (const ev of events) {
          if (ev.type !== 'state') continue;
          if (ev.to === CORE_STATE.EXPOSED && !result.exposed) result.exposed = snap();
          if (ev.to === CORE_STATE.CRITICAL && !result.critical) result.critical = snap();
          if (ev.to === CORE_STATE.MELTDOWN && !result.core) result.core = { ...snap(), cause: ev.cause || core.cause, host: ev.host === hull ? 'kadłub' : 'fragment' };
        }
        // rdzeń mógł przejść na fragment (odcięcie) — liczy się tak samo
        if (!result.core && core.state === CORE_STATE.MELTDOWN) result.core = { ...snap(), cause: core.cause, host: core.host === hull ? 'kadłub' : 'fragment' };
      }
      if (step % 2 === 0) {
        DestructorSystem.updateVisuals(PHYS_DT * 2, entities);
        if (cpuSoft) cpuSoft.tick(entities, DESTRUCTOR_CONFIG, PHYS_DT * 2);
      }
      if (attritionAt && !result.attrition) result.attrition = { ...snap(), cause: attritionAt.cause };
      if (result.core && result.attrition) break;
      // Rdzeń padł pierwszy: próg wyniszczenia ekstrapolujemy (stałe DPS), bez
      // symulowania reszty — pula HP i sufit heksów liczone na chwilę killa.
      if (result.core && !result.attrition && extrapolateAttrition) break;
      // Rakiety 3D nie ruszają heksów — rdzeń nieosiągalny, wystarczy próg HP.
      if (isRocket3D(weapon) && result.attrition) break;
    }
  } finally {
    if (spreadPatched) weapon.spread = origSpread;
    restoreProbes();
  }
  result.simTime = +time.toFixed(2);
  // Stan na koniec przebiegu (przy przekroczeniu limitu: ile zdążyło wejść).
  result.final = snap();
  result.stats = { ...stats };
  if (result.core && !result.attrition && time > 0) {
    const dealt = stats.primaryDamage || 0;
    const hpLeft = hull.isPlayer ? hull.hull.val : hull.hp;
    const dps = dealt / Math.max(1e-6, time);
    const hitsPerSec = (stats.primaryHits || 0) / Math.max(1e-6, time);
    const tLeft = dps > 0 ? Math.max(0, hpLeft) / dps : Infinity;
    result.attrition = {
      estimated: true,
      time: +(time + tLeft).toFixed(2),
      hits: Math.round((stats.primaryHits || 0) + hitsPerSec * tLeft),
      damage: Math.round(dealt + Math.max(0, hpLeft)),
      cause: 'ekstrapolacja'
    };
  }
  result.timedOut = !(result.core && result.attrition) && time >= maxTime;
  result.first = result.core && result.attrition
    ? (result.core.time <= result.attrition.time ? 'rdzeń' : 'wyniszczenie')
    : (result.core ? 'rdzeń' : (result.attrition ? 'wyniszczenie' : '—'));
  result.ratio = result.core && result.attrition ? +(result.core.damage / Math.max(1, result.attrition.damage)).toFixed(3) : null;
  if (cpuSoft) result.softBodyTears = cpuSoft.stats.tears;
  result.wallMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
  for (const e of entities) disposeHexBody(e);
  return result;
}

// Wiersz tabeli PL.
export function formatBenchRow(r) {
  if (r.error) return `| ${HULLS[r.hullId]?.label || r.hullId} | ${r.weaponId} | ${DIRECTION_LABEL[r.direction] || r.direction} | błąd: ${r.error} |||||||`;
  const c = r.core;
  const a = r.attrition;
  const cell = (x) => x ? `${x.estimated ? '~' : ''}${x.hits} / ${x.damage} / ${x.time.toFixed(1)} s` : (r.timedOut ? `> ${r.simTime} s` : '—');
  return `| ${HULLS[r.hullId]?.label || r.hullId} | ${r.weaponId} | ${DIRECTION_LABEL[r.direction] || r.direction} | ${cell(c)} | ${cell(a)} | ${r.ratio ?? '—'} | ${r.first} | ${c ? c.hexesLost : '—'} | ${r.exposed ? r.exposed.hits : '—'} |`;
}

export const BENCH_TABLE_HEADER = [
  '| kadłub | broń | kierunek | rdzeń: trafień / obrażeń / czas | wyniszczenie: trafień / obrażeń / czas | rdzeń÷wyniszczenie (obrażenia) | pierwsze | heksów straconych przy killu rdzeniem | trafień do ODSŁONIĘCIA |',
  '|---|---|---|---|---|---|---|---|---|'
];
