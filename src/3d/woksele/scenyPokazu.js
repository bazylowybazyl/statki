// Plany scen strony na żywo, wspólne dla strony i wątku budowy. Bez three i DOM.
import { S1Lod, S1, S2, S3, S4, S5, krater, kolumna1, naroznik, odpornosc } from './scena.js';
import { planM1, planM2, planM3 } from './scenaMiasta.js';
import { scenaB1 } from './scenaBazy.js';

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

/**
 * Pomiar LOD obrazu (plan LOD, metoda G): cztery wieże S1 w kwadracie, około 60 tys. węzłów, jedna grupa i jedna siatka ijk (przerwa szersza niż zasięg wiązania).
 * Każda podcięta jak S1, co 0,4 s następna. Uniform uN i bufory solvera muszą to pomieścić: ?maxWez=61000.
 */
function planCzteryWieze() {
  const p = S1();
  const s0 = p.scena;
  const ile = 4, N = s0.n, m = p.czasy.indeksy.length;
  const krok = Math.round(1000 / s0.dx);
  const pos = new Float32Array(3 * N * ile), kind = new Uint8Array(N * ile), ijk = new Int32Array(3 * N * ile);
  const indeksy = new Int32Array(m * ile), t = new Float64Array(m * ile);
  for (let q = 0; q < ile; q++) {
    const ax = q & 1, ay = q >> 1;
    for (let i = 0; i < N; i++) {
      const b = 3 * (q * N + i);
      pos[b] = s0.pos[3 * i] + (ax - 0.5) * krok * s0.dx;
      pos[b + 1] = s0.pos[3 * i + 1] + (ay - 0.5) * krok * s0.dx;
      pos[b + 2] = s0.pos[3 * i + 2];
      ijk[b] = s0.ijk[3 * i] + ax * krok;
      ijk[b + 1] = s0.ijk[3 * i + 1] + ay * krok;
      ijk[b + 2] = s0.ijk[3 * i + 2];
      kind[q * N + i] = s0.kind[i];
    }
    for (let c = 0; c < m; c++) {
      indeksy[q * m + c] = q * N + p.czasy.indeksy[c];
      t[q * m + c] = p.czasy.t[c] + 0.4 * q;
    }
  }
  const scena = { ...s0, n: N * ile, pos, kind, ijk, grupa: new Uint8Array(N * ile), vel0: null, kluczStatyki: undefined, meta: { ...s0.meta, grupy: [{ nazwa: 'wieza', start: 0, n: N * ile }] } };
  return { ...p, id: 'LOD60', scena, czasy: { indeksy, t, rozerwij: new Uint8Array(m * ile), zostawZiarna: false } };
}

export const PLANY_POKAZU = {
  LOD60: planCzteryWieze,
  // Miasto (plan LOD § 5): opcje z adresu (?miasto={"dx":10}).
  M1: (ziarno, lod, miasto) => planM1(miasto ?? {}),
  M2: (ziarno, lod, miasto) => planM2(miasto ?? {}),
  M3: (ziarno, lod, miasto) => planM3(miasto ?? {}),
  // Baza piratów (plan LOD § 5c): opcje z adresu (?baza={"dx":80}), strona podaje je tym samym polem.
  B1: (ziarno, lod, baza) => scenaB1(baza ?? {}),
  // Ta sama baza bez skryptu zniszczeń: niszczy użytkownik narzędziami dema (dema/woksele-zawalenia/narzedzia.js), jak gracz w misji 1.
  // Szyja bez wzmocnienia (mocSzyi i giecieSzyi 1): przy sztywnym betonie (strona B1R ma domyślnie ?sztywnosc=2) pęka, a głowa przewraca się w całości.
  // Wzmocnienie ×8 obchodziło miękki beton (szyja ściśnięta o 23 % pod głową). ?baza={"mocSzyi":8,"giecieSzyi":8}: jak w grze.
  B1R: (ziarno, lod, baza) => scenaB1({ mocSzyi: 1, giecieSzyi: 1, ...(baza ?? {}), stoi: true }),
  // Ziarno z adresu strony (?ziarno=7), domyślnie 21 jak w filmie. Pozostałe sceny argumentu nie czytają.
  S5: (ziarno) => S5({ miejsce: 'g', ...(ziarno === undefined ? {} : { ziarno }) }),
  S5v: (ziarno) => S5({ miejsce: 'proznia', ...(ziarno === undefined ? {} : { ziarno }) }),
  S5p: (ziarno) => S5({ miejsce: 'planeta', ...(ziarno === undefined ? {} : { ziarno }) }),
  // lod: opcje S1Lod z adresu (?lodS1=…), próba 1 planu LOD. Bez nich zwykłe S1.
  S1: (ziarno, lod) => (lod ? S1Lod(lod) : S1()),
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
