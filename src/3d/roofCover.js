// src/3d/roofCover.js
//
// Dachy budowli nad płaszczyzną gry w TEJ klatce (E17): hale K-7 i zatoki ringów „Halo” z zamkniętym dachem (gracza
// w nich nie ma — K7RoofFade). Dach zasłania kadłuby pod sobą sam (głębia / kolejność passów), ale emiterów warstwy FG
// (billboardy lamp pozycyjnych) nie — kto rysuje na FG rzeczy stojące w halach (proxy statków ruchu: zapas floty
// na padach K-7), pyta `RoofCover.covers(x, y)`. Źródła rejestrują się same (HaloRingGame — strona albo worker
// renderu, każdy wątek ma własny rejestr). Bez three i DOM.

const sources = [];

export const RoofCover = {
  /** Źródło z metodą `roofCovers(x, y)` (punkt świata gry). */
  add(source) {
    if (source && typeof source.roofCovers === 'function' && !sources.includes(source)) sources.push(source);
  },

  remove(source) {
    const i = sources.indexOf(source);
    if (i >= 0) sources.splice(i, 1);
  },

  /** Czy punkt świata gry leży pod zamkniętym dachem. */
  covers(x, y) {
    for (let i = 0; i < sources.length; i++) if (sources[i].roofCovers(x, y)) return true;
    return false;
  }
};
