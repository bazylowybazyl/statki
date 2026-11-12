// src/game/hullDesign/workships/workKit.js
//
// KREATOR KADŁUBÓW — ZESTAW DO PRESETÓW STATKÓW ROBOCZYCH (złomowanie; czysty: bez three i DOM). Każdy statek to osobny
// plik w tym katalogu: `export default { key, label, cls: [mostek, rdzeń], make }`, rejestr w ./index.js (HD_PRESETS
// dokłada go sam, klasa idzie do applySystemSlots). Klocki, systemy, ładunek i napisy — z zestawu frachtowców
// (../freighters/freighterKit.js, eksportowane stąd dalej); tu baza projektu i GNIAZDA pod ruchome części.
//
// Decyzje użytkownika (2026-11-10): złomowanie to proces — złapać i usztywnić wrak → wypompować paliwo → zdemontować
// silniki, reaktor, bronie → pociąć kadłub. Lasery tnące i dźwigi siedzą w ZWYKŁYCH GNIAZDACH BRONI (obrotnica `rig`
// jest gniazdem głównym — HD_MOUNT_MODULES), jeden statek może mieć i lasery, i dźwigi. „Od góry” (kosz + dźwig)
// i „rampą / paszczą” to RÓŻNE sposoby ładowania. Statki: złomiarz, paszcza, młyn (daje surowiec „złom”, nie stal),
// rafineria (staje obok młyna), frachtowiec z rampą, dźwig z damperami.
//
// Ruchome części (wysięgnik, dźwig, szczęki, walce, klapa, podpora) NIE są kadłubem — to modele gry na mocowaniach.
// Kreator daje statyczny kadłub z gniazdami i wygląd „zamknięty”; miejsca osprzętu dla gry liczy
// ../hullDesignWorkRig.js (ułamki długości kadłuba, x — dziób, y — prawa burta).
//
// Zasady presetu jak u frachtowców (pilnują testy na wszystkich HD_PRESET_KEYS; jeden preset:
// node scripts/kreator-sprawdz-preset.mjs --plik src/game/hullDesign/workships/<klucz>.js --png .tmp/kreator/robocze).
// Układ: j. świata, x ku dziobowi, y w dół obrazu (y > 0 — prawa burta); połowa okrętu y ≤ 0, lustro dopisuje drugą.

export * from '../freighters/freighterKit.js';

/** Barwa napisów i pasów statków roboczych (żółć ostrzegawcza palety „Roboczy”). */
export const WORK_INK = '#e0a31f';

/**
 * Statek roboczy bazowy: rola cywilna, paleta „Roboczy” (grafit, stal, żółte pasy), mało okien, wyraźne panele, sieć
 * systemów włączona. `o`: shapes, modules, castles, decals, grid, palette, style, windows, bevel, round, panels,
 * cargoLoad, pipes (gęstość sieci), pipeSeed, mirror.
 */
export function workship(name, seed, detail, o = {}) {
  return {
    v: 2, name, role: 'civil', style: o.style || 'chamfer', mirror: o.mirror !== false, palette: o.palette || 'work',
    seed, detail, grid: o.grid, windows: o.windows ?? 0.45, bevel: o.bevel ?? 1.7, round: o.round ?? 1, panels: o.panels ?? 0.85,
    cargoLoad: o.cargoLoad ?? 0.8, pipeNet: { density: o.pipes ?? 1, seed: o.pipeSeed ?? 0 },
    blocks: [], shapes: o.shapes || [], modules: o.modules || [], decals: o.decals || [], castles: o.castles || [], parts: []
  };
}

// ── GNIAZDA POD RUCHOME CZĘŚCI (src/game/hullDesign/hullDesignSchema.js: rig, maw, mill, ramp, damper) ──────────────
/** Obroty modułu: oś +x modułu ku dziobowi / rufie / burcie y < 0 (lustro odbija na drugą burtę). */
export const TO_FWD = 0, TO_AFT = Math.PI, TO_SIDE = -Math.PI / 2;
/** Obrotnica WYSIĘGNIKA z laserem tnącym (gniazdo główne `size`); jarzmo wzdłuż osi x modułu. */
export const boom = (x, y, r, size = 'M', rot = 0) => ({ type: 'rig', x, y, r, v: 0, size, rot });
/** Obrotnica DŹWIGU (gniazdo główne `size`): pas ostrzegawczy na tarczy, szersze jarzmo. */
export const crane = (x, y, r, size = 'M', rot = 0) => ({ type: 'rig', x, y, r, v: 1, size, rot });
/** Paszcza: zamknięte szczęki, pół-wymiary (w — wzdłuż osi, h — w poprzek); otwiera się ku +x modułu (dziób). */
export const maw = (x, y, w, h, rot = TO_FWD) => ({ type: 'maw', x, y, w, h, rot });
/** Gardziel młyna: n walców tnących (osie w poprzek osi x modułu). */
export const mill = (x, y, w, h, n = 2, rot = TO_FWD) => ({ type: 'mill', x, y, w, h, n, rot });
/** Rampa: zawias po stronie −x modułu, klapa opada ku +x (rufowa: rot = TO_AFT). */
export const ramp = (x, y, w, h, rot = TO_AFT) => ({ type: 'ramp', x, y, w, h, rot });
/** Gniazdo dampera (wysuwana podpora): wysuw ku +x modułu. */
export const damper = (x, y, w, h = w, rot = TO_SIDE) => ({ type: 'damper', x, y, w, h, rot });
/** Kosz — ładownia OTWARTA OD GÓRY (cargo v 4): dźwig wkłada z góry, widać złom. */
export const bin = (x, y, w, h, o = {}) => ({ type: 'cargo', x, y, w, h, rot: 0, v: 4, ...o });
/** Złącze przeładunku na burcie (pierścień `well` v 0 — gniazdo okrągłe): tu staje statek obok (młyn ↔ rafineria). */
export const coupling = (x, y, r) => ({ type: 'well', x, y, r, v: 0 });

/** Napis i pas w barwie roboczej. */
export const workLabel = (text, x, y, w, h, o = {}) => ({ kind: 'text', text, x, y, w, h, rot: 0, color: WORK_INK, opacity: 0.9, weight: 600, ...o });
export const workStripe = (x0, y0, x1, y1, w, o = {}) => ({ kind: 'stripe', x0, y0, x1, y1, w, color: WORK_INK, opacity: 0.85, ...o });
