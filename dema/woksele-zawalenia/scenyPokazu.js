// Plany scen strony na żywo, wspólne dla strony i wątku budowy. Bez three i DOM.
import { S1, S2, S3, S4, krater, kolumna1, naroznik, odpornosc } from './scena.js';

/** Krater jak w filmie (bieg-film.sh: c = (190, 0, 600), r = 60), wybuch po sekundzie stania. */
function planKratera() {
  const p = krater({ c: [190, 0, 600], r: 60, J: 300, rP: 160, T: 10 });
  if (p.gpu?.kratery?.[0]) p.gpu.kratery[0].f = 60;
  return p;
}

/** Krater r = 90 w próżni, ten sam co w tabeli § 8 (krater90p), wybuch po sekundzie stania. */
function planKratera90() {
  const p = krater({ c: [190, 0, 650], r: 90, J: 600, rP: 240, proznia: true, T: 10 });
  if (p.gpu?.kratery?.[0]) p.gpu.kratery[0].f = 60;
  return p;
}

export const PLANY_POKAZU = {
  S1: () => S1(),
  S2: () => S2(),
  S3: () => S3(),
  S4: () => S4(),
  S4grunt: () => S4({ g: 400, grunt: true, kotwice: true, T: 9 }),
  krater: planKratera,
  odpornosc: () => odpornosc(),
  kolumna: () => kolumna1(),
  naroznik: () => naroznik(),
  krater90: planKratera90,
  S3poza: () => S3({ wariant: 'poza' }),
  S3osm: () => S3({ wariant: 'osm' }),
};
