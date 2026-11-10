// src/3d/planetGen/planetGenWeather.js
//
// POGODA planety generatora: ruchome chmury bez symulacji płynu. Wzór chmur to nadal funkcja ziarna (graf wypieku
// chmur, planetGenBake.tsl.js) — pogoda dokłada do niego CZAS:
//   • WIATR STREFOWY: pasy szerokości obracają swój szum sztywno wokół osi planety (pasaty przy równiku w jedną
//     stronę, wiatry średnich szerokości w drugą, przy biegunach cisza); punkt miesza dwa sąsiednie pasy;
//   • CYKLONY: oś cyklonu jedzie z wiatrem swojej szerokości, szum w tarczy obraca się wokół osi (ramiona się kręcą);
//   • WILGOTNOŚĆ: wielkie plamy szumu obracane wokół osi pochylonej — chmury w miejscu gęstnieją i rzedną.
// Obraz w chwili t jest funkcją (ziarno, t) — bez stanu, więc zapis gry wystarczy trzymać sam czas pogody.
// MAPA POGODY (`PlanetGenWeather`): mapa chmur planety przeliczana w tle w PASACH celu (pas na klatkę) do drugiego
// celu, potem zamiana — bryła chmur, chmury płaskie i cień na gruncie czytają ją zamiast mapy wypieczonej raz.
// Kłęby bryły chmur jadą z tym samym wiatrem (planetGenCloudVolume.tsl.js: `puffNoise`). Obraz (zasada żelazna 1).
import { WX_BANDS, WX_PHASE } from './planetGenBake.tsl.js';

/** Domyślne tempo: wiatr [rad / s pogody] (pełny obrót pasa ~20 min), obrót cyklonu [rad / s], siła zmian wilgotności. */
export const WX_DEFAULT = Object.freeze({ wind: 0.005, spin: 0.05, humidity: 0.2 });

/** Prędkość kątowa wiatru strefowego na szerokości `lat` [rad]: −cos 3φ · wiatr (jak `bandAngle` grafu chmur). */
export const windRate = (lat, wind) => -Math.cos(3 * lat) * wind;
/** Szerokość środka pasa i (0 … WX_BANDS). */
export const bandLat = (i) => -Math.PI / 2 + i * Math.PI / WX_BANDS;
/** Prędkość kątowa pasa, do którego należy szerokość `lat` (najbliższy środek pasa — pas jedzie sztywno). */
export const bandRateAt = (lat, wind) => windRate(bandLat(Math.floor((lat / Math.PI + 0.5) * WX_BANDS + 0.5)), wind);
/** Kąt obrotu pasa i w chwili `time` (z fazą stałą pasa). */
export const bandAngle = (i, time, wind) => windRate(bandLat(i), wind) * time + i * WX_PHASE;

/**
 * Cyklon w chwili `time`: oś początkowa `axis0` (jednostkowa) przeniesiona wiatrem jej szerokości wokół osi planety,
 * kąt obrotu własnego (tropikalne — małe — kręcą się szybciej). Obrót wokół Y jak w grafie: (0, 0, 1) → (sin a, 0, cos a).
 */
export function cycloneAt(axis0, radius, time, wx) {
  const lat = Math.asin(Math.max(-1, Math.min(1, axis0[1])));
  const theta = windRate(lat, wx.wind) * time;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return {
    axis: [axis0[0] * c + axis0[2] * s, axis0[1], axis0[2] * c - axis0[0] * s],
    spin: wx.spin * time * (radius < 0.115 ? 1.6 : 1.0),
    theta
  };
}

/** Mapa pogody planety: zegar + przeliczanie mapy chmur w pasach do drugiego celu i zamiana. */
export class PlanetGenWeather {
  /**
   * `base` — wynik `bakeSystem` planety z chmurami. `size` — szerokość mapy pogody (wysokość = size / 2; pokrycie
   * jest miękkie — 1024 wystarcza bryle chmur i cieniom, drobny kształt niosą kłęby); `mpPerStep` — megapiksele
   * mapy przeliczane na klatkę (pas); `texelStep` — o ile tekseli mapy chmury mają się przesunąć przed nowym
   * przeliczeniem; `speed` — mnożnik czasu pogody.
   */
  constructor(baker, base, { size = 1024, speed = 1, time = 0, mpPerStep = 0.18, texelStep = 0.35, wind = WX_DEFAULT.wind, spin = WX_DEFAULT.spin, humidity = WX_DEFAULT.humidity } = {}) {
    this.baker = baker;
    this.base = base;
    this.size = size;
    this.speed = speed;
    this.time = time;
    this.wind = wind;
    this.spin = spin;
    this.humidity = humidity;
    this.enabled = true;
    this.targets = [baker.createWeatherTarget(size, `${base.spec.seed}:a`), baker.createWeatherTarget(size, `${base.spec.seed}:b`)];
    this.bands = Math.max(1, Math.ceil(size * (size / 2) / 1e6 / mpPerStep));
    // nowe przeliczenie dopiero, gdy chmury przesunęły się o `texelStep` teksela mapy (wiatr albo obrót cyklonu
    // na jego promieniu ~0,25 rad) — przy tempie ×1 kilka map na sekundę, nie mapa co klatkę
    this.minStep = texelStep * (2 * Math.PI / size) / Math.max(wind, spin * 0.25, 1e-9);
    this.front = -1;          // cel z aktualną mapą (−1: jeszcze żadna — `texture` zwraca mapę wypieczoną raz)
    this.bakedTime = NaN;     // czas pogody mapy w `front`
    this.job = null;          // przeliczenie w toku: { wx, slot, band }
    this.stats = { updates: 0, steps: 0 };
  }

  /** Bajty GPU obu celów (RGBA8 z mipmapami). */
  get bytes() { return 2 * Math.round(this.size * (this.size / 2) * 4 * 4 / 3); }

  /** Aktualna mapa chmur: mapa pogody albo (przed pierwszym przeliczeniem / pogoda wyłączona) mapa wypieczona raz. */
  get texture() { return this.enabled && this.front >= 0 ? this.targets[this.front].texture : this.base.maps.clouds; }

  /** Zamrożony stan pogody dla wypieku (mapa pogody, wycinek chmur pod kamerą) w chwili `time`. */
  snapshot(time = this.time) { return { time, wind: this.wind, spin: this.spin, humidity: this.humidity }; }

  /**
   * Stan dla materiałów (kłęby bryły, cień kłębów na gruncie): BIEŻĄCY czas pogody — kłęby jadą płynnie co klatkę,
   * mapa pokrycia dogania je skokami mniejszymi niż teksel (`minStep`).
   */
  get shown() { return this.enabled && this.front >= 0 ? this.snapshot() : null; }

  /** Cała mapa od razu (start, zmiana planety, skok czasu). */
  bakeNow() {
    const slot = this.front === 0 ? 1 : 0;
    const wx = this.snapshot();
    this.baker.bakeWeather(this.base, this.targets[slot], wx, 0, 1);
    this.front = slot;
    this.bakedTime = wx.time;
    this.job = null;
    this.stats.updates++;
  }

  /**
   * Krok: zegar pogody (dt [s] × `speed`) i jeden pas przeliczenia mapy. Zwraca true, gdy w tej klatce weszła nowa
   * mapa (wołający przepina `texture` w uniformach). Przy stojącym zegarze (speed 0) nic nie przelicza.
   */
  update(dt) {
    if (!this.enabled) return false;
    this.time += dt * this.speed;
    if (this.front < 0) { this.bakeNow(); return true; }
    if (!this.job && Math.abs(this.time - this.bakedTime) >= this.minStep) this.job = { wx: this.snapshot(), slot: this.front === 0 ? 1 : 0, band: 0 };
    if (!this.job) return false;
    const job = this.job;
    this.baker.bakeWeather(this.base, this.targets[job.slot], job.wx, job.band, this.bands);
    this.stats.steps++;
    if (++job.band < this.bands) return false;
    this.front = job.slot;
    this.bakedTime = job.wx.time;
    this.job = null;
    this.stats.updates++;
    return true;
  }

  dispose() {
    this.job = null;
    for (const t of this.targets) t.dispose();
  }
}
