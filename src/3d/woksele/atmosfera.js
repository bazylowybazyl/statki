// Spalanie odłamków bazy w atmosferze planety pod nią (demo wokseli, prośba użytkownika 2026-11-09: „gdyby baza była nad Ziemią / Marsem —
// planetą z atmosferą … palące się odłamki tak jak w realu; największe dolecą, ale muszą się bardziej pomniejszyć na tak dużej planecie”).
// Czyste dane i wzorzec CPU modelu: bez three, bez DOM. Kernel GPU (spalanie.js) liczy te same wzory na węzłach solvera i drobinach gruzu.
//
// SKALA: odłamki mają rozmiar prawdziwy (1 j. = 1 m, węzeł bazy 40 j.), więc planeta i jej powietrze też: promienie i skale wysokości rzeczywiste.
// Planety gry (Ziemia 37 800 j., Mars 30 000 j., poświata limbu 1250 / 700 j.) to mapa ściśnięta ~170 razy wobec okrętów: ich skala wysokości
// wyszłaby 50–100 j., cieńsza niż jeden węzeł, a cała atmosfera niższa od bazy. Hidalgo w grze też ma rozmiar prawdziwy (r 48 km), stąd ta umowa.
// GRAWITACJA z gry (400 j./s², PIRATE_BASE_SOLID.gravity, Mars × 0,38 jak w realu): baza spada z 60–110 km, więc odłamki wchodzą w gęste powietrze
// z prędkością 5–9 km/s, jak śmieci wracające z orbity. Bez tego (9,8 m/s² i spadek z zawieszenia) nic by nie płonęło.
//
// MODEL (meteor uproszczony, Bronshten / Ceplecha):
//   ρ(h) = ρ0 · e^(−h / H)                         gęstość powietrza (izotermiczna)
//   q = ½ · Λ · ρ · v³                             strumień ciepła na czoło [W/m²] (Λ: ułamek energii strumienia powietrza, który grzeje odłamek)
//   dδ/dt = q / (ρm · Q*)                          cofanie się czoła (ablacja) [m/s]: węzeł ginie, gdy czoło cofnie się o całą komórkę
//   a = ½ · Cd · ρ · v² / (ρm · L)                 opór na czole, L: grubość odłamka wzdłuż lotu
//   T: σ · ε · T⁴ = q (równowaga promienista), z bezwładnością cieplną                barwa żaru
// ρm i Q* to wartości SKUTECZNE konstrukcji bazy (puste pomieszczenia, cienkie ścianki ze stali i stopów lekkich): blok 40 m to głównie powietrze
// i blacha, która topi się i rwie w strugi. Lity beton (2400 kg/m³, Q* ~ 8 MJ/kg) przeżyłby prawie cały.

export const SIGMA = 5.670e-8;

/** Materiał spalania: skuteczne wartości konstrukcji bazy (strojone wzorcem CPU, tests/wokseleSpalanie.test.mjs). */
export const MATERIAL_SPALANIA = Object.freeze({
  rhoM: 300, // [kg/m³] gęstość skuteczna bloku (pomieszczenia, grodzie, poszycie)
  Q: 6e5, // [J/kg] skuteczne ciepło ablacji (topienie, utlenianie i zdzieranie cienkich ścianek)
  lambda: 0.1, // ułamek strumienia energii powietrza, który idzie w odłamek
  cd: 1.0, // współczynnik oporu bryły tępej
  eps: 0.9, // emisyjność
  tauGrzanie: 0.35, // [s] bezwładność cieplna przy grzaniu
  tauStygniecie: 2.5, // [s] stygnięcie (żar gaśnie powoli po wyjściu z gęstego powietrza)
  tOtoczenia: 250, // [K]
  ulamekZgonu: 0.15, // resztka cieńsza niż tyle grubości wyparowuje (węzeł ginie, drobina znika)
});

/**
 * Planety pod bazą w demie. R, H, ρ0, g: dane rzeczywiste (Ziemia, Mars), gMnoz: ułamek grawitacji sceny (400 j./s² to Ziemia gry).
 * wysBazy: wysokość płaszczyzny gry (z = 0) nad powierzchnią [j.]: ponad atmosferą, z której zaczyna się spalanie (Ziemia ~100 km, Mars ~60 km).
 * barwy: plazma czoła i smugi (Ziemia: powietrze N₂/O₂ świeci biało z zielenią tlenu i czerwienią azotu; Mars: CO₂ i CO pomarańczowo-różowo), dym, mgiełka.
 */
export const PLANETY_ATM = Object.freeze({
  hidalgo: Object.freeze({ id: 'hidalgo', nazwa: 'Hidalgo', atmosfera: null }),
  ziemia: Object.freeze({
    id: 'ziemia', nazwa: 'Ziemia', R: 6_371_000, wysBazy: 110_000, gMnoz: 1,
    atmosfera: Object.freeze({
      rho0: 1.225, H: 8500,
      plazma: [1.0, 0.92, 0.85], plazmaBrzeg: [0.55, 1.0, 0.62], plazmaOgon: [1.0, 0.35, 0.28],
      dym: [0.52, 0.5, 0.48],
      // Mgiełka z góry: Rayleigh (5,8; 13,5; 33,1)·10⁻⁶ /m · H + aerozol 0,06 → grubość optyczna w zenicie.
      tauZenit: [0.11, 0.17, 0.33], mgla: [0.42, 0.62, 1.0],
    }),
    grunt: 'ziemia',
  }),
  mars: Object.freeze({
    id: 'mars', nazwa: 'Mars', R: 3_389_500, wysBazy: 60_000, gMnoz: 0.379,
    atmosfera: Object.freeze({
      rho0: 0.020, H: 11_100,
      plazma: [1.0, 0.78, 0.55], plazmaBrzeg: [1.0, 0.52, 0.42], plazmaOgon: [1.0, 0.42, 0.22],
      dym: [0.55, 0.42, 0.32],
      // Pył: grubość optyczna 0,4–0,6 w pogodny dzień, rozprasza rudo („toffi”).
      tauZenit: [0.42, 0.5, 0.62], mgla: [0.95, 0.68, 0.45],
    }),
    grunt: 'mars',
  }),
});

/** Planeta z adresu (`?planeta=hidalgo|ziemia|mars`); nieznana i brak → Hidalgo. */
export function planetaZAdresu(nazwa) {
  return PLANETY_ATM[String(nazwa || '').toLowerCase()] ?? PLANETY_ATM.hidalgo;
}

/** Gęstość powietrza [kg/m³] na wysokości h [m]. */
export function gestosc(atm, h) {
  return atm.rho0 * Math.exp(-Math.max(0, h) / atm.H);
}

/** Strumień ciepła na czoło [W/m²]. */
export function strumienCiepla(rho, v, m = MATERIAL_SPALANIA) {
  return 0.5 * m.lambda * rho * v * v * v;
}

/** Temperatura równowagi promienistej [K] przy strumieniu q. */
export function temperaturaRownowagi(q, m = MATERIAL_SPALANIA) {
  return Math.max(m.tOtoczenia, Math.pow(Math.max(q, 0) / (m.eps * SIGMA), 0.25));
}

/**
 * Wzorzec CPU: spadek pionowy jednego odłamka z wysokości h0 od zera, krok dt.
 * gruby: grubość wzdłuż lotu [m] (warstwy węzłów · dx; tylko czoło się grzeje i hamuje całość). maly: drobina gruzu (kostka o boku `gruby`, kurczy się cała).
 * Zwraca, gdzie odłamek spłonął (hSpalony) albo z jaką prędkością i grubością doleciał, najwyższą temperaturę i wysokość pierwszego żaru (T > 1000 K).
 */
export function symulujSpadek({ planeta, h0 = planeta.wysBazy, gruby = 40, maly = false, g = 400, dt = 1 / 60, vMax = 12000, m = MATERIAL_SPALANIA } = {}) {
  const atm = planeta.atmosfera;
  const gP = g * (planeta.gMnoz ?? 1);
  let h = h0, v = 0, L = gruby, T = m.tOtoczenia, t = 0;
  let Tmax = T, hZar = null, hTmax = h0, hSpalony = null;
  while (h > 0 && t < 600) {
    const rho = atm ? gestosc(atm, h) : 0;
    const q = strumienCiepla(rho, v, m);
    const Teq = temperaturaRownowagi(q, m);
    T += (Teq - T) * (1 - Math.exp(-dt / (Teq > T ? m.tauGrzanie : m.tauStygniecie)));
    if (T > Tmax) { Tmax = T; hTmax = h; }
    if (hZar === null && T > 1000) hZar = h;
    // Drobina kurczy się z każdej strony (koziołkuje): bok maleje o q / (3 ρm Q*), blok — czoło o q / (ρm Q*).
    const dL = (q / (m.rhoM * m.Q)) * dt * (maly ? 1 / 3 : 1);
    L -= dL;
    if (L <= m.ulamekZgonu * gruby) { hSpalony = h; break; }
    const a = gP - (0.5 * m.cd * rho * v * v) / (m.rhoM * L);
    v = Math.min(vMax, Math.max(0, v + a * dt));
    h -= v * dt;
    t += dt;
  }
  return { hSpalony, doleciał: hSpalony === null, vUderzenia: hSpalony === null ? v : 0, grubyKoniec: Math.max(0, L), ulamek: Math.max(0, L) / gruby, Tmax, hTmax, hZar, czas: t };
}
