// src/game/playerSave.js
//
// ZAPIS GRACZA (2026-11-07, decyzja użytkownika „pełny zapis gracza jak najbardziej, trzeba zrobić”) — klucz
// localStorage['game'], obok `loadout` (kadłuby, fit, magazyn broni) i `economy` (rynki, pas, floty, ziarno świata).
// Do tej pory F5 zawsze stawiał Atlasa przy Ziemi z 1200 kredytami, pustą ładownią i kampanią od zera: pozycja,
// kredyty, ładownia, reputacja, doświadczenie i postęp fabuły nie były zapisywane nigdzie.
//
// Co niesie zapis:
//  - `systemId` — układ gwiezdny, w którym stoi gracz (dziś zawsze 'sol'; pod wiele układów — przejście między
//    układami będzie przeładowaniem strony z innym układem, więc zapis musi wiedzieć, który zbudować);
//  - `worldSeed` — ziarno kątów planet; MUSI być równe ziarnu zapisu ekonomii (inaczej pozycja trafia w inny układ
//    planet) — `parsePlayerSave` odrzuca zapis z innym ziarnem;
//  - `player` — pozycja i kurs (ostatnie miejsce w zwykłym locie, nie w skoku: warp przelatuje przez wszystko),
//    kredyty, ładownia, ładunki górnicze, reputacja, doświadczenie (`progress`), załoga i ludzie w kabinach na
//    kontraktach rotacyjnych (`crew`, workforce W6 — src/game/playerCrew.js; brak pola = przydział frakcji);
//  - `campaign` — kampania: faza w chwili zapisu i stan między misjami (`m1`, `bossEscaped`). Stanu W ŚRODKU misji
//    (baza piratów, fale, herszt) nie da się wiernie odtworzyć, więc wczytanie wznawia od ostatniego punktu wznowienia
//    (`campaignCheckpoint`, `CAMPAIGN_RESUME` w story/campaign.js: początek misji 1, misji 2, zasadzka, powrót), a zapis
//    po nagrodzie misji — od następnego punktu (bez drugiej nagrody); po ukończeniu kampanii — gra swobodna w zapisanym
//    miejscu. Kredyty zarobione w trakcie powtarzanego odcinka (zestrzelenia, łup) mogą przyjść drugi raz.
// Kadłub (uszkodzenia belek), NPC i wraki nie są zapisywane — po wczytaniu kadłub jest cały.
// Bez DOM i three (testy node: tests/playerSave.test.mjs).

import { DEFAULT_STAR_SYSTEM_ID } from '../data/starSystems.js';
import { serializePlayerCrew, parsePlayerCrew } from './playerCrew.js';

export const PLAYER_SAVE_KEY = 'game';
export const PLAYER_SAVE_VERSION = 1;
export const DEFAULT_SYSTEM_ID = DEFAULT_STAR_SYSTEM_ID;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Mapa { klucz: liczba } — tylko liczby > 0 (ładownia), zaokrąglone do 1/1000, klucze po kolei. */
export function serializeAmounts(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  for (const key of Object.keys(map).sort()) {
    const n = finite(map[key]);
    if (n > 0) out[key] = Math.round(n * 1000) / 1000;
  }
  return out;
}

/** Mapa liczb z zapisu (śmieci i liczby ≤ 0 odpadają); `isKnown(key)` odsiewa klucze spoza katalogu. */
export function readAmounts(raw, isKnown = () => true) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const n = finite(value);
    if (n > 0 && isKnown(key)) out[key] = n;
  }
  return out;
}

/**
 * Punkt wznowienia kampanii dla fazy z zapisu. `resume` — opis kampanii (`CAMPAIGN_RESUME` z
 * `src/game/story/campaign.js`): `phases` (wszystkie fazy po kolei), `checkpoints` (fazy, od których kampania umie ruszyć;
 * pierwsza = zwykły start), `rewardPhases` (fazy, w których skrypt wypłaca nagrodę misji). Wynik:
 *  - `{ mode: 'campaign', startPhase: null }` — od zwykłego startu kampanii (dok K-7, intro);
 *  - `{ mode: 'campaign', startPhase: '<punkt>' }` — skok do punktu (wcześniejsze fazy „pominięte”, bez nagród);
 *  - `{ mode: 'free' }` — kampania ukończona (faza 'done', `done`), nieaktywna albo brak punktu po nagrodzie.
 * Punkt = ostatni `checkpoint` nie później niż faza zapisu; gdy między nim a fazą zapisu (włącznie) leży faza z nagrodą,
 * wznowienie idzie od pierwszego punktu PO tej nagrodzie — nagroda jest już w zapisanych kredytach, reputacji i EXP.
 */
export function campaignCheckpoint(campaign, resume) {
  if (!campaign || typeof campaign !== 'object') return { mode: 'free' };
  if (campaign.done || !campaign.active) return { mode: 'free' };
  const phase = typeof campaign.phase === 'string' ? campaign.phase : null;
  if (phase === 'done') return { mode: 'free' };
  const phases = Array.isArray(resume?.phases) ? resume.phases : [];
  const checkpoints = (Array.isArray(resume?.checkpoints) ? resume.checkpoints : [])
    .map(p => phases.indexOf(p)).filter(i => i >= 0).sort((a, b) => a - b);
  const rewards = (Array.isArray(resume?.rewardPhases) ? resume.rewardPhases : [])
    .map(p => phases.indexOf(p)).filter(i => i >= 0);
  const at = phase ? phases.indexOf(phase) : -1;
  if (!checkpoints.length || at < 0) return { mode: 'campaign', startPhase: null };
  let cp = checkpoints[0];
  for (const i of checkpoints) if (i <= at) cp = i;
  // ostatnia nagroda wypłacona między punktem a fazą zapisu → pierwszy punkt po niej
  let paid = -1;
  for (const r of rewards) if (r >= cp && r <= at && r > paid) paid = r;
  if (paid >= 0) {
    const next = checkpoints.find(i => i > paid);
    if (next === undefined) return { mode: 'free' };
    cp = next;
  }
  return { mode: 'campaign', startPhase: cp === checkpoints[0] ? null : phases[cp] };
}

/** Numer misji (od 1) dla fazy kampanii — `resume.missions`: listy faz misji po kolei; 0 — nieznana. */
export function campaignMissionNumber(phase, resume) {
  const missions = Array.isArray(resume?.missions) ? resume.missions : [];
  const idx = missions.findIndex(list => Array.isArray(list) && list.includes(phase));
  return idx + 1;
}

/**
 * Zapis gracza do localStorage. `input`:
 *  - `worldSeed`, `systemId`, `savedAt` (ms), `playTimeSec`;
 *  - `player`: { x, y, angle, credits, cargo, cargoCost, miningCharges, reputation, progress, hullId, crew };
 *    `cargoCost` — średnia cena zakupu partii w ładowni [CR/szt.] (komputer handlowy E23a: zysk wobec ceny zakupu);
 *  - `campaign`: { active, phase, done, m1, bossEscaped } albo null (gra swobodna).
 */
export function buildPlayerSave(input = {}) {
  const p = input.player || {};
  const c = input.campaign || null;
  const progress = p.progress && typeof p.progress === 'object' ? p.progress : {};
  const reputation = {};
  if (p.reputation && typeof p.reputation === 'object') {
    for (const key of Object.keys(p.reputation).sort()) {
      const n = Number(p.reputation[key]);
      if (Number.isFinite(n)) reputation[key] = Math.round(n * 100) / 100;
    }
  }
  return {
    version: PLAYER_SAVE_VERSION,
    savedAt: Math.round(finite(input.savedAt, 0)),
    worldSeed: input.worldSeed >>> 0,
    systemId: String(input.systemId || DEFAULT_SYSTEM_ID),
    playTimeSec: Math.max(0, Math.round(finite(input.playTimeSec, 0))),
    player: {
      x: Math.round(finite(p.x) * 10) / 10,
      y: Math.round(finite(p.y) * 10) / 10,
      angle: Math.round(finite(p.angle) * 1e4) / 1e4,
      credits: Math.max(0, Math.round(finite(p.credits))),
      cargo: serializeAmounts(p.cargo),
      cargoCost: serializeAmounts(p.cargoCost),
      miningCharges: serializeAmounts(p.miningCharges),
      reputation,
      progress: {
        exp: Math.max(0, Math.round(finite(progress.exp))),
        missionsDone: Array.isArray(progress.missionsDone) ? progress.missionsDone.map(String) : []
      },
      hullId: p.hullId ? String(p.hullId) : null,
      crew: serializePlayerCrew(p.crew)
    },
    campaign: c ? {
      active: !!c.active,
      phase: typeof c.phase === 'string' ? c.phase : null,
      done: !!c.done,
      m1: c.m1 && typeof c.m1 === 'object' ? { ...c.m1 } : null,
      bossEscaped: !!c.bossEscaped
    } : null
  };
}

/**
 * Zapis z localStorage (obiekt albo tekst JSON) → `{ save, reason }`. `save` = null, gdy: brak, śmieci, inna wersja,
 * inne ziarno świata niż `opts.worldSeed` (zapis z innego układu planet — pozycja trafiłaby w inne miejsce), inny
 * układ gwiezdny niż `opts.systemId` (strona zbudowała inny układ),
 * pozycja poza światem (`opts.bounds`: { w, h }). `reason` — powód odrzucenia do dziennika.
 */
export function parsePlayerSave(raw, opts = {}) {
  if (raw === null || raw === undefined || raw === '') return { save: null, reason: 'brak' };
  let data = raw;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return { save: null, reason: 'nieczytelny' }; }
  }
  if (!data || typeof data !== 'object') return { save: null, reason: 'nieczytelny' };
  if (data.version !== PLAYER_SAVE_VERSION) return { save: null, reason: `wersja ${data.version}` };
  if (opts.worldSeed !== undefined && (data.worldSeed >>> 0) !== (opts.worldSeed >>> 0)) {
    return { save: null, reason: `inne ziarno świata (${data.worldSeed})` };
  }
  // Strona zbudowała inny układ gwiezdny (np. `?uklad=`) — pozycja z zapisu leży w innym układzie.
  if (opts.systemId !== undefined && String(data.systemId || DEFAULT_SYSTEM_ID) !== String(opts.systemId)) {
    return { save: null, reason: `inny układ (${data.systemId})` };
  }
  const p = data.player;
  if (!p || typeof p !== 'object' || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) {
    return { save: null, reason: 'brak pozycji' };
  }
  const b = opts.bounds;
  if (b && (p.x < 0 || p.y < 0 || p.x > b.w || p.y > b.h)) return { save: null, reason: 'pozycja poza światem' };
  return {
    save: {
      ...data,
      systemId: String(data.systemId || DEFAULT_SYSTEM_ID),
      player: {
        ...p,
        x: Number(p.x),
        y: Number(p.y),
        angle: finite(p.angle),
        credits: Math.max(0, Math.round(finite(p.credits))),
        cargo: readAmounts(p.cargo, opts.isKnownCargo),
        cargoCost: readAmounts(p.cargoCost, opts.isKnownCargo),
        miningCharges: readAmounts(p.miningCharges),
        reputation: p.reputation && typeof p.reputation === 'object' ? { ...p.reputation } : {},
        progress: {
          exp: Math.max(0, Math.round(finite(p.progress?.exp))),
          missionsDone: Array.isArray(p.progress?.missionsDone) ? p.progress.missionsDone.map(String) : []
        },
        crew: parsePlayerCrew(p.crew)
      }
    },
    reason: null
  };
}

/** Krótki opis zapisu do menu: „7 lis, 14:05 · Gra swobodna” / „· Kampania, misja 2”. `opts.resume` — CAMPAIGN_RESUME. */
export function describePlayerSave(save, opts = {}) {
  if (!save) return '';
  const parts = [];
  const at = Number(save.savedAt);
  if (at > 0) {
    try {
      parts.push(new Date(at).toLocaleString(opts.locale || 'pl-PL', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      }));
    } catch { /* bez daty */ }
  }
  const cp = campaignCheckpoint(save.campaign, opts.resume);
  if (cp.mode === 'campaign') {
    // misja, od której gra ruszy (punkt wznowienia), nie ta z chwili zapisu
    const from = cp.startPhase || opts.resume?.phases?.[0];
    parts.push(`Kampania, misja ${Math.max(1, campaignMissionNumber(from, opts.resume))}`);
  } else {
    parts.push('Gra swobodna');
  }
  return parts.join(' · ');
}
