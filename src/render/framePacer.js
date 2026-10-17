// src/render/framePacer.js — STAŁY WIEK obrazu 3D w kompozycji B2cr (audyt renderu 2026-10-17,
// docs/AUDYT-render-worker-2026-10-17.md).
//
// Bitmapa strony k wraca z workera i wchodzi na ekran z klatką strony, w której zostanie złożona
// (`transferFromImageBitmap` + przełączenie kanw nakładek). Złożenie od razu po przyjściu daje wiek obrazu zależny od
// tego, czy bitmapa zdążyła przed następnym vsynciem: w dużej bitwie przy 240 Hz raz 2, raz 3–4 klatki — treść 3D
// stoi klatkę i przeskakuje o dwie w ~44% klatek (judder całego obrazu, także tła za kamerą).
// Tu: bitmapy czekają w kolejce wołającego, a na POCZĄTKU każdej klatki strony (takt rAF — `beginFrame`) składana jest
// najnowsza bitmapa strony wysłanej `age − 1` klatek wcześniej albo starszej. `age` dobierany sam z „potrzebnego
// wieku” przychodzących bitmap: podnoszony od razu, gdy w krótkim oknie spóźnień jest za dużo, obniżany po długim
// oknie, w którym niższy wiek prawie zawsze by wystarczył.
//
// Wiek w klatkach strony: strona k wysłana w klatce P(k), złożona na początku klatki G — na ekranie od klatki G + 1,
// wiek = G + 1 − P(k) (2 = złożenie w klatce po wysłaniu, jak przy szybkim workerze).
//
// Czysty moduł (bez DOM): bitmapy i kanwy trzyma wołający (renderWorkerHost.js). Bez alokacji w klatce.

const RING = 256;   // strony w drodze (numer klatki wysłania po k & 255)
const NEED = 2048;  // pierścień potrzebnego wieku ostatnich przyjść (okna doboru wieku ≤ NEED)

export class FramePacer {
  /**
   * @param {{ minAge?: number, maxAge?: number, raiseWindow?: number, raiseLate?: number, lowerWindow?: number,
   *   lowerLate?: number }} [o] — okna w przyjściach bitmap; spóźnienia: przyjścia z potrzebnym wiekiem > `age`
   */
  // Strojenie z pomiaru w oknie 240 Hz (bitwa 166 okrętów): przy oknach 48 / 480 wiek skakał 3 ↔ 5 kilkanaście razy na
  // minutę (każda zmiana to jedna klatka powtórzona albo przeskoczona) — podniesienie przy > 3 spóźnieniach na 64
  // przyjścia (~5%), obniżenie po ~5 s (1200 przyjść), gdy niższy wiek spóźniłby się najwyżej 6 razy (0,5%).
  constructor({ minAge = 2, maxAge = 5, raiseWindow = 64, raiseLate = 3, lowerWindow = 1200, lowerLate = 6 } = {}) {
    this.minAge = minAge;
    this.maxAge = maxAge;
    this.raiseWindow = raiseWindow;
    this.raiseLate = raiseLate;
    this.lowerWindow = lowerWindow;
    this.lowerLate = lowerLate;
    this.age = minAge;
    this.frame = 0;
    this._postK = new Float64Array(RING).fill(-1);
    this._postF = new Int32Array(RING);
    // potrzebny wiek ostatnich przyjść (pierścień) i liczniki okien
    this._need = new Uint8Array(NEED);
    this._needN = 0;
    this._sinceChange = 0;
    this.stats = { arrived: 0, late: 0, raised: 0, lowered: 0, ageHist: new Int32Array(16) };
  }

  /** Początek klatki strony (takt rAF, przed złożeniem). */
  beginFrame() {
    this.frame++;
  }

  /** Strona k wysłana do workera w bieżącej klatce. */
  posted(k) {
    const i = k & (RING - 1);
    this._postK[i] = k;
    this._postF[i] = this.frame;
  }

  /** Klatka wysłania strony k (−1 — nieznana: stara albo spoza pierścienia). */
  postedFrame(k) {
    const i = k & (RING - 1);
    return this._postK[i] === k ? this._postF[i] : -1;
  }

  /** Bitmapa strony k przyszła (między taktami): potrzebny wiek i dobór `age`. */
  arrived(k) {
    const pf = this.postedFrame(k);
    if (pf < 0) return;
    // najwcześniej złożona na początku następnej klatki (frame + 1), na ekranie od frame + 2
    const need = Math.min(15, this.frame + 2 - pf);
    const st = this.stats;
    st.arrived++;
    if (need > this.age) st.late++;
    this._need[this._needN & (NEED - 1)] = need;
    this._needN++;
    this._sinceChange++;
    // podnieś: w krótkim oknie za dużo spóźnień przy bieżącym wieku
    if (this.age < this.maxAge && this._countAbove(this.age, this.raiseWindow) > this.raiseLate) {
      this.age++;
      this._sinceChange = 0;
      st.raised++;
      return;
    }
    // obniż: przez długie okno niższy wiek prawie zawsze by wystarczył
    if (this.age > this.minAge && this._sinceChange >= this.lowerWindow &&
        this._countAbove(this.age - 1, this.lowerWindow) <= this.lowerLate) {
      this.age--;
      this._sinceChange = 0;
      st.lowered++;
    }
  }

  _countAbove(age, window) {
    const n = Math.min(window, this._needN, NEED);
    let c = 0;
    for (let j = 1; j <= n; j++) if (this._need[(this._needN - j) & (NEED - 1)] > age) c++;
    return c;
  }

  /**
   * Czy stronę k wolno złożyć w bieżącej klatce (wiek ≥ docelowy). Nieznana klatka wysłania — tak (stara strona).
   */
  eligible(k) {
    const pf = this.postedFrame(k);
    return pf < 0 || this.frame + 1 - pf >= this.age;
  }

  /** Złożono stronę k w bieżącej klatce — wiek do statystyk. */
  composed(k) {
    const pf = this.postedFrame(k);
    if (pf < 0) return;
    const a = Math.min(15, this.frame + 1 - pf);
    this.stats.ageHist[a]++;
  }
}
