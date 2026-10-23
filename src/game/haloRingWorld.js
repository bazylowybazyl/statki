// src/game/haloRingWorld.js
//
// ŚWIAT RINGÓW „HALO” PO STRONIE GRY (RW-27, docs/PLAN-render-worker.md § 2.6 p. 6–8, § 4): wszystko, od czego
// zależy rozgrywka ringów Ziemi, Marsa i Jowisza, bez three, DOM i GPU:
//   • `entries` [{ key, planet, collider, place, service }] — kolidery (płyta, teren, ściany portu K-7:
//     HaloRingCollider), rejestr hal i zatok (pozy obsługi stanowisk, lampki, poziom lamp), automat obsługi
//     stanowisk capital (k7BerthService.js);
//   • teren w kolizjach: Mars (ECUMENE) i Jowisz (Fable) od razu z czystych planów CPU (ecumenePlan.js,
//     fablePlan.js — ta sama funkcja, którą ring-archetyp liczy z treści po zbudowaniu); Ziemia z mapy CPU ringu
//     renderu po jego zbudowaniu (`setRingTerrain` — w trybie `inline` funkcja ringu, w workerze profil z = 0
//     przez postMessage);
//   • automat obsługi stanowisk K-7 w CZASIE GRY dla każdego ringu, bez bramki widoczności (dawniej krokowany
//     w renderze tylko dla ringu zbudowanego i w kadrze — nigdy w podzielonym ekranie);
//   • zajętość i lampki stanowisk w rejestrze (`owner.layout.berths[].occupied / reserved` + `owner.berthVersion`
//     — piszą automat i fabuła; render przenosi je na lampki hali przy zmianie wersji);
//   • zegar migania świateł hal (`clock` — ten sam dostaje shader hali i wejście pyłu hal) i poziom lamp hali
//     dzień / noc (`owner.lampLevel` — cień planety ze słońca gry; dawniej pisał go render).
// Obraz ringów (src/3d/haloRing/haloRingGame.js) czyta te dane; sam liczy kamerę, LOD, wycięcia, dachy
// i fizykę przewodów paliwowych (obraz).

import { HALO_RING_PLANETS, haloRingKey } from './haloRingPlanets.js';
import { HaloRingCollider } from './haloRingCollision.js';
import { createK7BerthService, stepK7BerthService, syncK7BerthLamps } from './k7BerthService.js';
import { k7BeaconClock } from '../3d/haloRing/haloPortK7Lights.js';
import { resolveHaloProfile } from '../3d/haloRing/haloRingProfiles.js';
import { createEcumenePlan } from '../3d/haloRing/arch/ecumenePlan.js';
import { createFablePlan } from '../3d/haloRing/arch/fablePlan.js';
import { createBudowaPlan } from '../3d/haloRing/arch/budowaPlan.js';

export const HALO_WORLD = Object.freeze({
  // Wysokość słońca nad płaszczyzną ringu [°] (jak obraz — HALO_GAME.sunElevationDeg; zgodność pilnuje test).
  sunElevationDeg: 49,
  // Poziom lamp hali K-7: 0,22 w pełnym słońcu, + 0,5 w cieniu planety (haloPortK7.js — uHallLights.x).
  lampDay: 0.22,
  lampNight: 0.5
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Teren ringów-archetypów z planu (archRing.js `terrainHeightAt`: θ = atan2(y, x) w [0, 2π), z = 0).
const ARCH_PLANS = Object.freeze({ ecumene: createEcumenePlan, fable: createFablePlan, budowa: createBudowaPlan });

function archTerrainFor(key, layout) {
  const spec = HALO_RING_PLANETS[key];
  const archetype = resolveHaloProfile(spec?.profile).archetype || 'halo';
  const make = ARCH_PLANS[archetype];
  if (!make) return null;
  const plan = make(layout, layout.seed);
  return (x, y) => {
    let th = Math.atan2(y, x);
    if (th < 0) th += Math.PI * 2;
    return plan.heightAt(th, 0);
  };
}

export class HaloRingWorld {
  /** @param {{ planets?: Array }} o planety gry (ring mają Ziemia, Mars, Jowisz) */
  constructor({ planets = [] } = {}) {
    this.entries = [];
    this.clock = 0;
    this._ships = [null];
    this.setPlanets(planets);
  }

  /** Planety z ringiem — kolidery, rejestr i automat stanowisk od razu (teren archetypów z planu). */
  setPlanets(planets) {
    for (const planet of planets || []) {
      const key = haloRingKey(planet);
      if (!key || this.entries.some((e) => e.key === key)) continue;
      const collider = new HaloRingCollider(planet);
      const reg = collider.registry;
      // Stanowiska wolne: statków ruchu jeszcze nie ma (ring nie udaje życia) — dawniej zerował je obraz po
      // zbudowaniu ringu (domyślny układ K-7 ma gracza na pierwszym stanowisku).
      for (const owner of reg.halls) {
        for (const b of owner.layout.berths) { b.occupied = null; b.reserved = null; }
        owner.berthVersion = 0;
        owner.lampLevel = HALO_WORLD.lampDay;
      }
      const terrain = archTerrainFor(key, collider.layout);
      if (terrain) collider.setTerrain(terrain);
      this.entries.push({
        key,
        planet,
        collider,
        place: collider.place,
        // automat obsługi stanowisk capital (gra swobodna: zamki pola, ramiona i przewody paliwowe przy postoju gracza)
        service: createK7BerthService(reg),
        // teren Ziemi z mapy ringu renderu (setRingTerrain); archetypy — z planu od razu
        terrainReady: !!terrain,
        // słońce w układzie ringu (pamięć jak w obrazie — wektor przeliczany przy zmianie azymutu > 1e-6)
        sunAz: NaN,
        sunX: 0, sunY: 0, sunZ: 1
      });
    }
  }

  entry(key) {
    return this.entries.find((e) => e.key === key) || null;
  }

  /** Rejestr hali K-7 (`registry.halls[i]`: pozy, stanowiska, lampki, poziom lamp) ringu `key` albo null. */
  hall(key, i = 0) {
    return this.entry(key)?.collider?.registry?.halls?.[i] || null;
  }

  /**
   * Teren ringu w kolizjach płyty: `fn(lx, ly)` → wysokość nad podłogą w układzie lokalnym ringu (Ziemia: mapa
   * CPU ringu renderu po zbudowaniu). null — płyta bez rzeźby.
   */
  setRingTerrain(key, fn) {
    const e = this.entry(key);
    if (!e) return;
    e.collider.setTerrain(fn);
    e.terrainReady = typeof fn === 'function';
  }

  /**
   * Teren z MAPY CPU ringu renderu ({ w, h, heights } — mapa wysokości w uv podłogi, jak `heightAtUV` map świata):
   * tryb worker (RW-41c) — ring Ziemi piecze tylko worker i wysyła mapę grze. Ta sama dwuliniowa próbka co obraz.
   */
  setRingTerrainMap(key, map) {
    const e = this.entry(key);
    const L = e?.collider?.layout;
    if (!L || !map || !(map.w > 0) || !(map.h > 0) || !map.heights) return;
    const { w, h, heights } = map;
    const f = {};
    this.setRingTerrain(key, (lx, ly) => {
      L.worldToFloor(lx, ly, 0, f);
      const x = ((f.u % 1) + 1) % 1 * w - 0.5;
      const y = Math.max(0, Math.min(h - 1, f.v * h - 0.5));
      const x0 = Math.floor(x), y0 = Math.floor(y);
      const fx = x - x0, fy = y - y0;
      const X0 = ((x0 % w) + w) % w, X1 = (X0 + 1) % w, Y1 = Math.min(h - 1, y0 + 1);
      const a = heights[y0 * w + X0] * (1 - fx) + heights[y0 * w + X1] * fx;
      const b = heights[Y1 * w + X0] * (1 - fx) + heights[Y1 * w + X1] * fx;
      return a * (1 - fy) + b * fy;
    });
  }

  /**
   * Stanowisko hali K-7 zajęte / zarezerwowane (fabuła): zapis w rejestrze, wersja przy zmianie (albo `force`)
   * — obraz przenosi ją na lampki. Zwraca true, gdy wersja się zmieniła.
   */
  setBerthState(key, hallIndex, berthId, occupied, reserved, force = false) {
    const owner = this.hall(key, hallIndex);
    const b = owner?.layout?.berths?.find((x) => x.id === berthId);
    if (!b) return false;
    if (b.occupied === occupied && b.reserved === reserved && !force) return false;
    b.occupied = occupied;
    b.reserved = reserved;
    owner.berthVersion++;
    return true;
  }

  /**
   * Klatka gry (render(), przed obrazem ringów i wejściem pyłu hal): zegar migania świateł hal (zegar ściany —
   * jak dawniej), automat obsługi stanowisk w czasie gry (0 w pauzie i scenach fabuły) dla gracza, lampki
   * z automatu, poziom lamp hal ze słońca gry.
   * @param {{ nowMs: number, gameDt: number, ship: object|null, sun: {x:number,y:number}|null }} f
   */
  frame({ nowMs, gameDt = 0, ship = null, sun = null } = {}) {
    this.clock = k7BeaconClock(nowMs);
    const dt = Number.isFinite(gameDt) ? Math.max(0, gameDt) : 0;
    const alive = ship && !ship.dead && ship.pos;
    this._ships[0] = alive ? ship : null;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.collider.setPlanet(e.planet);
      // Obsługa stanowisk capital w grze swobodnej (src/game/k7BerthService.js): gracz stoi na polu stanowiska —
      // zamki pola, ramiona i przewody paliwowe podpinają się, rusza — awaryjne odpięcie. Pozy fabuły
      // (owner = 'story') nietknięte.
      stepK7BerthService(e.service, dt, e.place, this._ships, 1);
      const halls = e.collider.registry.halls;
      this._updateSun(e, sun);
      for (let k = 0; k < halls.length; k++) {
        const owner = halls[k];
        if (syncK7BerthLamps(e.service, k, owner.layout.berths)) owner.berthVersion++;
        const o = owner.frame?.origin;
        if (o) owner.lampLevel = HALO_WORLD.lampDay + HALO_WORLD.lampNight * (1 - this.daylight(e, o.x, o.y));
      }
    }
  }

  // Kierunek do słońca w układzie ringu (jak obraz: HaloRingGame._applySun + ring.setSun → uSunDir): azymut
  // do Słońca gry minus obrót ringu, wysokość 49°, wektor znormalizowany jak THREE.Vector3.normalize.
  _updateSun(e, sun) {
    const sx = Number(sun?.x);
    const sy = Number(sun?.y);
    const world = Number.isFinite(sx) && Number.isFinite(sy) ? Math.atan2(-(sy - e.place.y), sx - e.place.x) : 0;
    const local = world - e.place.rot;
    if (Math.abs(local - e.sunAz) < 1e-6) return;
    e.sunAz = local;
    const el = HALO_WORLD.sunElevationDeg * Math.PI / 180;
    const ce = Math.cos(el);
    let x = ce * Math.cos(local);
    let y = ce * Math.sin(local);
    let z = Math.sin(el);
    const k = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    x *= k; y *= k; z *= k;
    e.sunX = x; e.sunY = y; e.sunZ = z;
  }

  /** Światło dnia w punkcie ringu (układ lokalny; cień planety) — lampy hal K-7 nocą (jak HaloRingGame._daylight). */
  daylight(e, x, y) {
    const L = e.collider.layout;
    const oz = -L.planetCenterZ;
    const t = -(x * e.sunX + y * e.sunY + oz * e.sunZ);
    if (t <= 0) return 1;
    const d = Math.sqrt(Math.max(0, x * x + y * y + oz * oz - t * t));
    const R = L.planetRadius;
    const k = clamp01((d - (R - 500)) / 1300);
    return k * k * (3 - 2 * k);
  }

  // ── Rozgrywka ───────────────────────────────────────────────────────────────

  // Kolizje statku ze wszystkimi ringami (płyta; walls = ściany portu dla graczy).
  // Wynik ostatniego trafienia albo null (ringi się nie nakładają).
  constrainShip(ship, walls = false) {
    let hit = null;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.collider.setPlanet(e.planet);
      const res = e.collider.constrainShip(ship, walls);
      if (res.hit) hit = res;
    }
    return hit;
  }

  // Odległość wzdłuż kursu do płyty najbliższego ringu (HaloRingCollider.rayToSlab) albo Infinity.
  rayToSlab(x, y, dx, dy, len, pad = 0) {
    let best = Infinity;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.collider.setPlanet(e.planet);
      const s = e.collider.rayToSlab(x, y, dx, dy, Math.min(len, best), pad);
      if (s < best) best = s;
    }
    return best;
  }

  // Środek statku przeszedł w kroku przez płytę któregoś ringu (HaloRingCollider.blockTunnel) — cofnięty; wynik albo null.
  blockTunnel(ship, prevX, prevY) {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.collider.setPlanet(e.planet);
      const res = e.collider.blockTunnel(ship, prevX, prevY);
      if (res.hit) return res;
    }
    return null;
  }

  // Punkt świata gry w płycie któregoś ringu (pociski).
  pointInSlab(x, y, z = 0) {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      e.collider.setPlanet(e.planet);
      if (e.collider.pointInSlab(x, y, z)) return true;
    }
    return false;
  }
}
