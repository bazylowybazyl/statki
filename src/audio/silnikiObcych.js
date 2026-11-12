// Silniki obcych okrętów w pobliżu kadru — synteza silnika MAIN (przepis `engineMain`, ta sama rodzina co silnik
// gracza), nie plik: do `maks` głosów naraz (reżyser src/game/dzwiekiObszarow.js wybiera najbliższe okręty z ciągiem),
// każdy z położeniem w kadrze (panorama, głośność i filtr odległości z `polozenie`). Głos bez odświeżenia przez
// `CZAS_OBCEGO_BEZ_ODSWIEZENIA` gaśnie (okręt wyszedł z kadru, zgasił silnik, przegrał miejsce z bliższym).
// Bez alokacji na klatkę: sloty powstają przy starcie głosu (zdarzenie), położenie przez stały obiekt `poz`.
import { engineMain } from './przepisySyntezy.js';
import { paramDefaults, dbToGain } from './synteza.js';
import { polozenie } from './dzwiekiLogika.js';

export const CZAS_OBCEGO_BEZ_ODSWIEZENIA = 0.3;

/**
 * @param {{ ctx: BaseAudioContext, syntezator: () => object, kadr: () => object|null, poziomDb: number,
 *           maks?: number, czyWyciszony?: () => boolean, liczStart?: () => void }} o
 */
export function utworzSilnikiObcych(o) {
  const { ctx, syntezator, kadr } = o;
  const maks = Math.max(1, o.maks | 0 || 3);
  const sloty = []; // { klucz, h, ostatnio, ciag, dopal }
  const poz = { glos: 1, pan: 0 };

  function ustawPolozenie(s, x, y, teraz) {
    polozenie(x, y, kadr ? kadr() : null, poz);
    const E = syntezator();
    const v = s.h.voice;
    if (!v || !v.dVol) return poz.glos;
    const dist = Math.min(1, Math.max(0, (1 - poz.glos) * 0.7));
    v.dVol.gain.setTargetAtTime(E.distGain(dist) * dbToGain(o.poziomDb) * poz.glos, teraz, 0.12);
    v.dLp.frequency.setTargetAtTime(E.distCutoff(dist), teraz, 0.12);
    v.dPan.pan.setTargetAtTime(poz.pan, teraz, 0.1);
    return poz.glos;
  }

  /** Okręt `klucz` (obiekt encji) pracuje silnikiem MAIN z ciągiem 0…1 w (x, y) — wołane co klatkę. */
  function silnik(klucz, ciag, dopalacz, x, y) {
    if (o.czyWyciszony && o.czyWyciszony()) return;
    const teraz = ctx.currentTime;
    const c = ciag < 0 ? 0 : ciag > 1 ? 1 : ciag;
    const b = dopalacz ? 1 : 0;
    for (let i = 0; i < sloty.length; i++) {
      const s = sloty[i];
      if (s.klucz !== klucz) continue;
      s.ostatnio = teraz;
      if (Math.abs(c - s.ciag) > 0.03) { s.h.set('throttle', c); s.ciag = c; }
      if (b !== s.dopal) { s.h.set('boost', b); s.dopal = b; }
      ustawPolozenie(s, x, y, teraz);
      return;
    }
    if (sloty.length >= maks) return;
    polozenie(x, y, kadr ? kadr() : null, poz);
    if (!(poz.glos > 0.02)) return;
    const dist = Math.min(1, Math.max(0, (1 - poz.glos) * 0.7));
    const h = engineMain.play(syntezator(), paramDefaults(engineMain, { throttle: c, boost: b }),
      { dist, pan: poz.pan, gain: dbToGain(o.poziomDb) * poz.glos, reverb: 0.3 });
    if (!h) return;
    sloty.push({ klucz, h, ostatnio: teraz, ciag: c, dopal: b });
    if (o.liczStart) o.liczStart();
  }

  function klatka(teraz) {
    for (let i = sloty.length - 1; i >= 0; i--) {
      const s = sloty[i];
      if (teraz - s.ostatnio <= CZAS_OBCEGO_BEZ_ODSWIEZENIA && !(o.czyWyciszony && o.czyWyciszony())) continue;
      s.h.release();
      sloty[i] = sloty[sloty.length - 1];
      sloty.length--;
    }
  }

  function zatrzymaj() {
    for (const s of sloty) s.h.release();
    sloty.length = 0;
  }

  return { silnik, klatka, zatrzymaj, get aktywne() { return sloty.length; } };
}
