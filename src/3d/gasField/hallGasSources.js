// src/3d/gasField/hallGasSources.js
//
// ŹRÓDŁA GAZU W HALI K-7 (2026-10-07, prośba użytkownika: „coś powinno ten gaz produkować i powinien być trochę
// widoczny … przewody paliwowe — z nich może powolnie wylatywać gaz, przy odpięciu mocniej”). Część CZYSTA (bez
// three, DOM i Core3D — testy node); strona renderu (hallDust.js) woła ją co klatkę i dopisuje źródła do tablicy
// strumieni pola gazu (gasField2D.js: stożek albo buch promieniowy z narzuconą prędkością + wstrzykiwana para / pył).
//
// Źródła (układ hali, komórki domeny):
//   • ZŁĄCZKA przewodu paliwowego (2 na stanowisko capital) — tam, gdzie niesie ją ramię SCARA (haloPortK7Fuel.js:
//     k7FuelCouplerAt z poz `extension` / `seat`): stale sączy parę (wiruje powoli — smużki), podpięta z przepływem —
//     lekko przecieka na złączu; KONTROLOWANY UPUST (poza `vent`) — strumień na zewnątrz stanowiska; RYGLOWANIE
//     i ODRYGLOWANIE (lock przechodzi przez 0,5 — w tej chwili złączka siada na wlewie / puszcza wlew) — BUCH pary
//     dookoła złączki, płatami we wszystkie strony po obwodzie (2026-10-07, prośba użytkownika: przewody „mają buchać
//     dymem we wszystkie strony po obwodzie przy przypinaniu / odpinaniu”); zwijanie przewodu — para za złączką.
//     Zdarzenia buchów (`src.events`) czyta też hallDust.js — kłęby pary z puli dymu rakiet nad kadłubem;
//   • SZPULA (bęben) na słupku paliwowym: zawór bezpieczeństwa co kilkadziesiąt sekund (harmonogram k7VentEnvelope —
//     kogut nad bębnem miga w tej samej fazie, shader hali);
//   • ZAWORY MAGAZYNÓW przy ścianie tylnej: rzadkie, mocne upusty w głąb hali (kogut nad zaworem);
//   • WENTYLACJA: dwa wolne nawiewy od ściany tylnej ku bramie — gaz w hali powoli płynie także bez statków.
// Zegar: `clock` z wejścia (zegar migania świateł hali) — koguty i upusty w tej samej fazie; dt — czas gry
// (pauza = 0: buchy stoją jak symulacja).
import { K7_VENT_DUR, K7_VENT_WARN, k7LightRig, k7VentEnvelope } from '../haloRing/haloPortK7Lights.js';
import { k7FuelCouplerAt, k7FuelGeometry } from '../haloRing/haloPortK7Fuel.js';
import { HALL_DUST_IN, HALL_DUST_SERVICE, HALL_DUST_SERVICE_BERTHS } from './hallDustLayout.js';

/** Strojenie źródeł (na żywo: HallDustTune.gas). Gęstości pary [jednostki pola / s], prędkości [j/s]. */
export const HALL_GAS_TUNE = {
  enabled: true,
  seep: 0.12,            // złączka: stałe sączenie
  seepSpeed: 95,
  weep: 0.14,            // podpięta z przepływem: przeciek na złączu
  vent: 10,              // kontrolowany upust (× poza vent)
  ventSpeed: 1600,
  burst: 13,             // odryglowanie: buch pary dookoła złączki (gaśnie e^(−2,4 t))
  burstSpeed: 1500,
  burstReach: 640,       // zasięg buchu [j.] (× wygaszenie)
  burstSec: 1.6,
  latch: 6,              // ryglowanie: mniejszy buch (wyrównanie ciśnienia na złączu)
  latchSpeed: 900,
  latchReach: 380,
  latchSec: 0.9,
  ring: 30,              // promień obwodu złączki, z którego bucha para [j.]
  dribble: 0.8,          // zwijanie przewodu: para za złączką
  reelSeep: 0.04,        // szpula: stałe sączenie
  relief: 3,             // szpula: zawór bezpieczeństwa (harmonogram)
  reliefSpeed: 900,
  wallSeep: 0.03,        // zawór magazynu: stałe sączenie
  wall: 5,               // zawór magazynu: upust (harmonogram)
  wallSpeed: 1400,
  fanSpeed: 140,         // wentylacja: nawiew od ściany tylnej
  fanRate: 0.5
};

/** Liczba rekordów strumienia na klatkę (najwięcej) — limit miejsca w tablicy strumieni pola. */
export const HALL_GAS_MAX = 40;

/** Rodzaje zdarzeń buchu (src.events): ryglowanie i odryglowanie złączki. */
export const HALL_GAS_EVENT = Object.freeze({ latch: 1, unlatch: 2 });
/** Zdarzenie: rodzaj, x, y (wysokość K-7), z złączki, siła, przewód. */
export const HALL_GAS_EVENT_STRIDE = 6;
const EVENT_CAP = 16;

/**
 * Stan źródeł hali (z układu `layout`): przewody (geometria ramienia, złączka, szpula, harmonogram zaworu), zawory
 * ścienne, nawiewy, pamięć rygli (na przewód) i zdarzenia buchów tej klatki.
 */
export function createHallGasSources(layout, rig = k7LightRig(layout)) {
  const capital = layout.berths.filter((b) => b.size === 'CAPITAL').slice(0, HALL_DUST_SERVICE_BERTHS);
  const hoses = [];
  capital.forEach((b, bi) => {
    for (const a of b.serviceAnchors) {
      const vent = rig.vents.find((v) => v.kind === 'reel' && v.berthId === b.id && v.side === a.side);
      hoses.push({
        berth: bi, side: a.side,
        geom: k7FuelGeometry(b, a),
        anchor: { x: a.x, z: a.z },
        target: { x: a.target.x, z: a.target.z },
        seed: hoses.length * 1.618 + 0.37,
        vent,
        // złączka tej klatki (z pozy — gdzie niesie ją ramię) i upust
        cx: a.x, cy: 0, cz: a.z, venting: 0
      });
    }
  });
  const walls = rig.vents.filter((v) => v.kind === 'wall');
  const fans = [-1620, 1620].map((x) => ({ x, z: layout.backZ + 120, dirX: 0, dirZ: 1 }));
  return {
    hoses, walls, fans,
    // na przewód: poprzedni rygiel, wiek buchu po odryglowaniu / ryglowaniu (−1 = brak), poprzednie wysunięcie
    prevLock: new Float64Array(hoses.length),
    burstAge: new Float64Array(hoses.length).fill(-1),
    latchAge: new Float64Array(hoses.length).fill(-1),
    burstCount: new Float64Array(hoses.length),
    prevExt: new Float64Array(hoses.length),
    events: new Float64Array(EVENT_CAP * HALL_GAS_EVENT_STRIDE),
    eventCount: 0,
    env: { warn: 0, gas: 0, u: 0 },
    stats: { records: 0, bursts: 0, latches: 0, venting: 0 }
  };
}

/** Zeruje pamięć rygli i buchów (nowa hala). */
export function resetHallGasSources(src) {
  src.prevLock.fill(0);
  src.burstAge.fill(-1);
  src.latchAge.fill(-1);
  src.prevExt.fill(0);
  src.eventCount = 0;
}

function pushEvent(src, kind, H, strength, index) {
  if (src.eventCount >= EVENT_CAP) return;
  const o = src.eventCount * HALL_GAS_EVENT_STRIDE;
  const E = src.events;
  E[o] = kind;
  E[o + 1] = H.cx;
  E[o + 2] = H.cy;
  E[o + 3] = H.cz;
  E[o + 4] = strength;
  E[o + 5] = index;
  src.eventCount++;
}

const _c = { x: 0, y: 0, z: 0 };

/**
 * Dopisuje źródła klatki do tablicy strumieni `J` (Float32Array, 12 liczb na rekord, układ jak gasField2D.jets)
 * od rekordu `first`, najwyżej `max` rekordów. `IN` — wejście klatki (HALL_DUST_IN), `dom` — domena (komórki),
 * dt — czas gry [s], T — strojenie. Zwraca liczbę rekordów. Zdarzenia buchów tej klatki: src.events / eventCount.
 */
export function writeHallGasSources(src, J, first, max, IN, dom, dt, T = HALL_GAS_TUNE) {
  src.eventCount = 0;
  if (!T.enabled) { src.stats.records = 0; return 0; }
  const h = dom.h;
  const clock = Number(IN[HALL_DUST_IN.clock]) || 0;
  let n = 0;
  // stożek (radial = 0) albo buch promieniowy (radial = 1: dx, dz — przesunięcie szumu płatów, len — zasięg,
  // widthJ — promień obwodu)
  const put = (x, z, dx, dz, lenJ, widthJ, widen, speed, rate, vapor, dust, radial = 0) => {
    if (n >= max) return;
    const o = (first + n) * 12;
    J[o] = (x - dom.x0) / h;
    J[o + 1] = (z - dom.z0) / h;
    if (radial) {
      J[o + 2] = dx;
      J[o + 3] = dz;
    } else {
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      J[o + 2] = dx / l;
      J[o + 3] = dz / l;
    }
    J[o + 4] = lenJ / h;
    J[o + 5] = Math.max(1.2, widthJ / h);
    J[o + 6] = widen;
    J[o + 7] = speed / h;
    J[o + 8] = rate;
    J[o + 9] = vapor;
    J[o + 10] = dust;
    J[o + 11] = radial;
    n++;
  };
  const S = HALL_DUST_SERVICE;
  let bursts = 0;
  let latches = 0;
  let venting = 0;
  const env = src.env;
  for (let i = 0; i < src.hoses.length; i++) {
    const H = src.hoses[i];
    const so = HALL_DUST_IN.service + H.berth * S.stride;
    const lock = Number(IN[so + S.lock]) || 0;
    const ext = Math.min(1, Math.max(0, Number(IN[so + S.extension]) || 0));
    const seat = Math.min(1, Math.max(0, Number(IN[so + S.seat]) || 0));
    const flow = Number(IN[so + S.flow]) || 0;
    const vent = Number(IN[so + S.vent]) || 0;
    // złączka tam, gdzie niesie ją ramię (bez dynamiki — ta jest w renderze; różnica ułamka sekundy)
    k7FuelCouplerAt(H.geom, ext, seat, _c);
    H.cx = _c.x; H.cy = _c.y; H.cz = _c.z;
    H.venting = vent;
    const prev = src.prevLock[i];
    // ryglowanie: rygiel przechodzi przez 0,5 w górę ze złączką na wlewie — mały buch (wyrównanie ciśnienia)
    if (prev < 0.5 && lock >= 0.5 && seat > 0.8) {
      src.latchAge[i] = 0;
      pushEvent(src, HALL_GAS_EVENT.latch, H, 0.6, i);
    }
    // odryglowanie: rygiel przechodzi przez 0,5 w dół — złączka puszcza wlew, buch pary dookoła złączki
    if (prev >= 0.5 && lock < 0.5 && seat > 0.4) {
      src.burstAge[i] = 0;
      src.burstCount[i]++;
      pushEvent(src, HALL_GAS_EVENT.unlatch, H, 1, i);
    }
    if (src.burstAge[i] >= 0) src.burstAge[i] += dt;
    if (src.burstAge[i] > T.burstSec) src.burstAge[i] = -1;
    if (src.latchAge[i] >= 0) src.latchAge[i] += dt;
    if (src.latchAge[i] > T.latchSec) src.latchAge[i] = -1;
    const retract = ext < src.prevExt[i] - 1e-5 ? 1 : 0;
    src.prevLock[i] = lock;
    src.prevExt[i] = ext;

    const cx = H.cx;
    const cz = H.cz;
    // sączenie: kierunek wiruje powoli wokół „od słupka”, natężenie faluje — smużki zamiast stałej kreski
    let bx = cx - H.anchor.x;
    let bz = cz - H.anchor.z;
    if (bx * bx + bz * bz < 1) { bx = -H.side; bz = 0.2; }
    const ba = Math.atan2(bz, bx) + 0.9 * Math.sin(clock * 0.31 + H.seed) + 0.45 * Math.sin(clock * 0.83 + H.seed * 2.1);
    const pulse = 0.6 + 0.4 * Math.sin(clock * 1.7 + H.seed * 3.3);
    let vapor = T.seep * pulse + (lock > 0.97 ? T.weep * flow : 0);
    let speed = T.seepSpeed;
    let len = 170;
    let width = 44;
    let dirX = Math.cos(ba);
    let dirZ = Math.sin(ba);
    let rate = 2.2;
    // kontrolowany upust: na zewnątrz stanowiska i ku bramie (zawór przedmuchu na złączce)
    if (vent > 0.01) {
      venting++;
      vapor += T.vent * vent;
      speed = Math.max(speed, T.ventSpeed * vent);
      len = Math.max(len, 200 + 900 * vent);
      width = Math.max(width, 46 + 34 * vent);
      dirX = H.side;
      dirZ = 0.75;
      rate = 5;
    }
    // zwijanie przewodu: para ciągnie się za złączką
    if (retract && ext > 0.02 && ext < 0.98) vapor += T.dribble;
    put(cx, cz, dirX, dirZ, len, width, 0.28, speed, rate, vapor, 0);
    // buchy dookoła złączki: odryglowanie (duży) i ryglowanie (mały) — strumień promieniowy pola gazu
    const ba0 = src.burstAge[i];
    if (ba0 >= 0) {
      bursts++;
      const k = Math.exp(-ba0 * 2.4);
      const sh = H.seed * 3.1 + src.burstCount[i] * 1.37;
      put(cx, cz, Math.sin(sh) * 2.3, Math.cos(sh * 1.3) * 2.3, 140 + T.burstReach * k, T.ring, 0, T.burstSpeed * k, 6, T.burst * k, 0, 1);
    }
    const la = src.latchAge[i];
    if (la >= 0) {
      latches++;
      const k = Math.exp(-la * 3.2);
      const sh = H.seed * 5.3 + 0.7;
      put(cx, cz, Math.cos(sh) * 2.1, Math.sin(sh) * 2.1, 110 + T.latchReach * k, T.ring, 0, T.latchSpeed * k, 5, T.latch * k, 0, 1);
    }

    // szpula na słupku: stałe sączenie + zawór bezpieczeństwa wg harmonogramu (kogut w tej samej fazie)
    const v = H.vent;
    let rv = T.reelSeep;
    let rs = 60;
    let rl = 120;
    if (v) {
      k7VentEnvelope(clock, v.phase, v.period, env);
      if (env.gas > 0.01) {
        venting++;
        rv += T.relief * env.gas;
        rs = T.reliefSpeed * env.gas;
        rl = 160 + 420 * env.gas;
      }
      put(H.anchor.x + v.dirX * 40, H.anchor.z + v.dirZ * 40, v.dirX, v.dirZ, rl, 40, 0.3, rs, 4, rv, 0);
    }
  }
  // zawory magazynów przy ścianie tylnej
  for (const w of src.walls) {
    k7VentEnvelope(clock, w.phase, w.period, env);
    const g = env.gas;
    if (g > 0.01) venting++;
    put(w.x, w.z, w.dirX, w.dirZ, 200 + 900 * g, 60 + 30 * g, 0.22, g > 0.01 ? T.wallSpeed * g : 50, g > 0.01 ? 4.5 : 1,
      T.wallSeep + T.wall * g, g * 0.6);
  }
  // wentylacja: wolny nawiew od ściany tylnej ku bramie (bez gazu)
  for (const f of src.fans) put(f.x, f.z, f.dirX, f.dirZ, 2400, 200, 0.03, T.fanSpeed, T.fanRate, 0, 0);
  src.stats.records = n;
  src.stats.bursts = bursts;
  src.stats.latches = latches;
  src.stats.venting = venting;
  return n;
}

/** Okno upustu zaworu w cyklu harmonogramu [s] (koguty migają od 0, gaz od start do end). */
export const HALL_VENT_WINDOW = Object.freeze({ start: K7_VENT_WARN, end: K7_VENT_WARN + K7_VENT_DUR });
