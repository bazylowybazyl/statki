// ============================================================
// Baza piratów (misja 1) — punkty budowli a jej konstrukcja. Czyste funkcje (bez DOM i three); klej w index.html
// (blok bazy piratów: onBaseDamageStep, taran ciał bazy, krok fizyki po HullBodies.step).
//
// Zgłoszenie użytkownika 2026-10-14: „habitatu nie da się zniszczyć — bronią staje na ~32%, taranem też nie idzie”.
// (1) PROGI PUNKTÓW: co 1/steps punktów budowli pęka kawałek pod trafieniem, a pęknięty kawałek nie ma już brył
//     trafień (statyka schowana, ciało rozbite na odłamy-wraki). Habitat ma 5 kawałków z bryłami na 8 progów — po
//     piątym progu (37,5% punktów) nie było w co trafić i punkty stały (magazyn: 2 kawałki na 4 progi — 50%, pomosty:
//     10 na 14 — 29%). OSTATNI stojący kawałek budowli zostaje do jej śmierci (rozpad misji łamie go sam).
// (2) TARAN: zgniot ciał budowli (kawałki w bańce gracza) liczył tylko fizykę — ściana bębna traciła 80% węzłów,
//     a habitat miał 100%. Węzły stracone przez kawałek w oknie styku z okrętem spoza piratów (zdarzenie zderzenia
//     ≥ `ramMinSpeed`) zdejmują punkty: ubytek / wszystkie węzły budowli × maks. punkty × `ramHpMul` (jak sufit
//     punktów kadłuba okrętu — `HULL_INTEGRITY.npcExponent`, przy małym ubytku ~2,2 × udział).
// (3) BEZPIECZNIK: budowla bez stojącego kawałka (pęknięte, schowane albo zjedzone ogniem do zera) ginie — punkty
//     nie mogą zostać bez bryły, w którą da się trafić. Budowla z `noFuse` (habitat — śmierć z etapów) go nie ma.
// (4) PULE KAWAŁKÓW I ETAPY HABITATU (decyzje użytkownika 2026-11-03, zgłoszenie „punkty stają, ciężko zbić,
//     nienaturalnie się ostrzeliwuje”): kawałek z pulą (ćwiartki bębna, szyb) pęka od trafień W NIEGO (taran — od
//     zgniotu jego węzłów), nie od progu „kawałek najbliżej ostatniego trafienia”. Habitat ginie z ETAPÓW: wyłom
//     (`breachNeed` ćwiartek), wieża (szyja zerwana — szyb pęknięty z puli albo taran) i wieżowce na pomostach.
// ============================================================
import { pirateBaseChunkAt, pirateBaseNearestChunk } from '../../3d/portBuildings/pirateBaseLayout.js';

export const BASE_INTEGRITY_TUNE = {
  ramWindow: 0.5,     // s — węzły stracone tyle po ostatnim styku okrętu liczą się jako taran
  ramMinSpeed: 40,    // j/s — prędkość względna styku, od której liczy się taran (docisk bez ruchu — nie)
  ramHpMul: 2.2       // mnożnik udziału zgniecionych węzłów w punktach budowli
};

/**
 * Kawałek budowli `structure` do pęknięcia przy progu punktów: pod punktem (hx, hz) układu bazy, inaczej najbliższy
 * stojący. null — stoi tylko jeden (zostaje do śmierci budowli) albo żaden. isGone(id) → kawałek już pęknięty / schowany.
 */
export function baseStepChunk(layout, structure, hx, hz, isGone) {
  const ids = layout?.structures?.[structure];
  if (!ids) return null;
  const mine = (c) => !!c && c.structure === structure && !c.ghost && !isGone(c.id);
  let standing = 0;
  for (const id of ids) if (mine(layout.chunkById.get(id))) standing++;
  if (standing <= 1) return null;
  return pirateBaseChunkAt(layout, hx, hz, mine) || pirateBaseNearestChunk(layout, hx, hz, mine)?.id || null;
}

/**
 * Pule punktów kawałków budowli `structure`: kawałki bez duchów, których rodzaj ma wpis w `byKind` ({ drum: 6000, … }).
 * Zwraca { id: { hp, max } } (pusty obiekt — budowla bez pul).
 */
export function createPiecePools(layout, structure, byKind) {
  const pools = {};
  for (const id of layout?.structures?.[structure] || []) {
    const c = layout.chunkById.get(id);
    const max = c && !c.ghost ? Number(byKind?.[c.kind]) : NaN;
    if (max > 0) pools[id] = { hp: max, max };
  }
  return pools;
}

/**
 * Kawałek z pulą, który przyjmuje trafienie: `hint` (kawałek trafiony wprost — ciało, bryła), inaczej kawałek z pulą pod
 * punktem (hx, hz) układu bazy, inaczej najbliższy stojący z niewyczerpaną pulą. Trafienie w kawałek z pustą pulą zostaje
 * przy nim (nie przechodzi na inny). isGone(id) → kawałek pęknięty / schowany. null — budowla nie ma już czego trafić.
 */
export function poolPieceAt(layout, pools, hx, hz, isGone, hint = null) {
  if (!pools) return null;
  if (hint && pools[hint]) return hint;
  const has = (c) => !!c && !!pools[c.id];
  const alive = (c) => has(c) && pools[c.id].hp > 0 && !isGone(c.id);
  if (Number.isFinite(hx) && Number.isFinite(hz)) {
    const id = pirateBaseChunkAt(layout, hx, hz, has);
    if (id && !isGone(id)) return id;
  }
  return pirateBaseNearestChunk(layout, Number(hx) || 0, Number(hz) || 0, alive)?.id || null;
}

/** Obrażenia kawałka z puli; true — pula właśnie spadła do zera (kawałek ma pęknąć). */
export function damagePool(pools, id, dmg) {
  const p = pools ? pools[id] : null;
  if (!p || !(dmg > 0) || p.hp <= 0) return false;
  p.hp = Math.max(0, p.hp - dmg);
  return p.hp <= 0;
}

/**
 * Etapy finału habitatu: wyłom (pęknięte ćwiartki bębna, potrzeba `breachNeed`), wieża (szyja zerwana), wieżowce
 * (zniszczone z wszystkich). Kolejność dowolna. Zwraca { breach, breachNeed, tower, highrises, highrisesTotal, done,
 * total, left } — `left`: ułamek etapów do zrobienia (punkty habitatu = maks. × left; 0 — habitat ginie).
 */
export function habitatStages({ quadrantsDown = 0, breachNeed = 1, towerDown = false, highrisesDown = 0, highrisesTotal = 0 } = {}) {
  const breach = Math.min(Math.max(0, quadrantsDown | 0), breachNeed);
  const highrises = Math.min(Math.max(0, highrisesDown | 0), highrisesTotal);
  const total = breachNeed + 1 + highrisesTotal;
  const done = breach + (towerDown ? 1 : 0) + highrises;
  return { breach, breachNeed, tower: !!towerDown, highrises, highrisesTotal, done, total, left: total > 0 ? (total - done) / total : 0 };
}

/** Styk okrętu z kawałkiem budowli (zdarzenie zderzenia, czas symulacji silnika): otwiera okno taranu kawałka. */
export function noteBaseRam(piece, now, x, y) {
  if (!piece) return;
  piece.__ramT = now;
  piece.__ramX = x;
  piece.__ramY = y;
}

/** Kawałek wyłączony z rachunku taranu (pęka z progu punktów albo rozpadu misji — jego ubytek to nie taran). */
export function markBaseBroken(piece) {
  if (piece) piece.__broken = true;
}

/** Żywe węzły kawałka-ciała (ciało i wyspy z kotwicami). */
function liveNodes(p) {
  let n = 0;
  const e = p.entity;
  const b = e?.beamHull?.entity === e ? e.beamHull.body : null;
  if (b && !b.dead) n += b.activeNodes | 0;
  for (const s of p.islands || []) {
    const sb = s?.beamHull?.entity === s ? s.beamHull.body : null;
    if (sb && !sb.dead && sb.anchored !== false) n += sb.activeNodes | 0;
  }
  return n;
}

/** Kawałek jeszcze stoi (ma bryłę albo ciało, w które da się trafić). */
function standing(p, isGone) {
  return !p.ghost && !p.lost && !p.__broken && !(isGone && isGone(p.id));
}

/**
 * Krok (fizyka, po HullBodies.step). sites — miejsca ciał bazy ({ owner, pieces } — pirateBaseSites()), now — czas
 * symulacji silnika (HullBodies.simTime). hooks: pieceNodes(piece) → węzły kawałka w szablonie (do sumy budowli),
 * damage(owner, hp, x, y) — obrażenia budowli z taranu, pieceDamage(owner, id, hp, x, y) — obrażenia kawałka z pulą
 * (`owner.piecePools`: ubytek / węzły kawałka × jego pula × ramHpMul), kill(owner) — bezpiecznik (bez `owner.noFuse`),
 * isGone(id) → kawałek pęknięty albo schowany w bryle bazy. Zwraca obrażenia z taranu w tym kroku (suma).
 */
export function stepBaseIntegrity(sites, now, hooks, tune = BASE_INTEGRITY_TUNE) {
  if (!sites) return 0;
  let total = 0;
  for (const key in sites) {
    const site = sites[key];
    const owner = site?.owner;
    if (!owner || !(owner.hp > 0) || owner._destroyed3D) continue;
    const pools = owner.piecePools || null;
    let up = 0;
    let lost = 0;
    let rx = 0;
    let ry = 0;
    for (const p of site.pieces) {
      if (standing(p, hooks.isGone)) up++;
      if (p.ghost) continue;
      if (p.state !== 'live' || p.__broken) { p.__seen = -1; continue; }
      const alive = liveNodes(p);
      const seen = Number.isFinite(p.__seen) && p.__seen >= 0 ? p.__seen : alive;
      p.__seen = alive;
      const d = seen - alive;
      if (d > 0 && now - (Number.isFinite(p.__ramT) ? p.__ramT : -Infinity) <= tune.ramWindow) {
        const pool = pools ? pools[p.id] : null;
        if (pool && hooks.pieceDamage) {
          const hp = d / Math.max(1, Number(hooks.pieceNodes?.(p)) || 0) * pool.max * tune.ramHpMul;
          hooks.pieceDamage(owner, p.id, hp, p.__ramX, p.__ramY);
          total += hp;
          continue;
        }
        lost += d;
        rx = p.__ramX;
        ry = p.__ramY;
      }
    }
    if (up === 0) {
      if (!owner.noFuse) hooks.kill?.(owner);
      continue;
    }
    if (lost > 0) {
      if (!(site.__nodeTotal > 0)) {
        let n = 0;
        for (const p of site.pieces) if (!p.ghost) n += Math.max(0, Number(hooks.pieceNodes?.(p)) || 0);
        site.__nodeTotal = n;
      }
      if (site.__nodeTotal > 0) {
        const hp = lost / site.__nodeTotal * (Number(owner.maxHp) || 0) * tune.ramHpMul;
        if (hp > 0) {
          hooks.damage?.(owner, hp, rx, ry);
          total += hp;
        }
      }
    }
  }
  return total;
}
