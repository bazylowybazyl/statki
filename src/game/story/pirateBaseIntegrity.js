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
//     nie mogą zostać bez bryły, w którą da się trafić.
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
 * damage(owner, hp, x, y) — obrażenia budowli z taranu, kill(owner) — bezpiecznik, isGone(id) → kawałek pęknięty
 * albo schowany w bryle bazy. Zwraca obrażenia z taranu w tym kroku (suma).
 */
export function stepBaseIntegrity(sites, now, hooks, tune = BASE_INTEGRITY_TUNE) {
  if (!sites) return 0;
  let total = 0;
  for (const key in sites) {
    const site = sites[key];
    const owner = site?.owner;
    if (!owner || !(owner.hp > 0) || owner._destroyed3D) continue;
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
        lost += d;
        rx = p.__ramX;
        ry = p.__ramY;
      }
    }
    if (up === 0) {
      hooks.kill?.(owner);
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
