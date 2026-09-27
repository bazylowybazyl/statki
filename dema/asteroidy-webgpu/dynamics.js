// dema/asteroidy-webgpu/dynamics.js
//
// Zdarzenia i źródła światła dema: wybuchy (błysk + łuna w pyle), pociski
// (lecące światło, wybuch przy trafieniu w skałę), światło dysz,
// świecące skały (każda skała energetyczna, kryształu i uranu przy kadrze =
// światło) i flary dryfujące w polu (dopełniają liczbę świateł do suwaka).
// Stan w świecie gry (double), do GPU idzie względem początku sceny.

import { GLOW_ROUND, GLOW_STREAK } from './glowSprites.js';

export const EXPLOSION_CAP = 8;
export const SHOT_CAP = 16;

const EXPLOSION_LIFE = 1.9;
const SHOT_SPEED = 3400;
const SHOT_LIFE = 1.8;
// Flary: głównie ciepłe i chłodne biele (sygnałowe, magnezowe), rzadko barwne —
// setki barwnych świateł robiły z ciemnego rdzenia pola dyskotekę.
const FLARE_COLORS = [
  [1.0, 0.78, 0.52], [1.0, 0.78, 0.52], [1.0, 0.7, 0.42], [0.8, 0.88, 1.0],
  [0.8, 0.88, 1.0], [0.95, 0.93, 0.88], [1.0, 0.45, 0.3], [0.45, 0.85, 1.0]
];

// Moc flar (światło na skałach, blask duszka): głęboka noc ma być czarna poza
// reflektorami — flary to pojedyncze punkty, nie gwiazdozbiór (2026-09-27).
const FLARE_LIGHT = 0.55;
const FLARE_GLOW = 1.7;

// Świecące typy skał (indeksy ROCK_TYPES): kryształ, uran, energetyczna.
const GLOW_ROCK = { 4: [0.34, 0.82, 1.0], 6: [0.34, 1.0, 0.24], 8: [0.62, 0.5, 1.0] };

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Dynamics {
  constructor() {
    this.explosions = [];
    this.shots = [];
    this.flares = [];
    this.rng = mulberry(0xF1A2E);
    this.stats = { explosions: 0, shots: 0, flares: 0, rockLights: 0, engineLights: 0 };
  }

  /** Wybuch w punkcie świata (moc ~1 = standard). */
  explode(x, y, power = 1, time = 0) {
    if (this.explosions.length >= EXPLOSION_CAP) this.explosions.shift();
    this.explosions.push({ x, y, t0: time, power });
  }

  /** Pocisk z punktu (x, y) w stronę (tx, ty), z prędkością nośnika (vx, vy). */
  shoot(x, y, tx, ty, vx = 0, vy = 0, time = 0) {
    const dx = tx - x;
    const dy = ty - y;
    const l = Math.hypot(dx, dy) || 1;
    if (this.shots.length >= SHOT_CAP) this.shots.shift();
    this.shots.push({
      sx: x, sy: y, x, y, px: x, py: y,
      vx: vx + dx / l * SHOT_SPEED, vy: vy + dy / l * SHOT_SPEED,
      t0: time, alive: true
    });
  }

  /**
   * Ruch pocisków, trafienia w skały (kula przekroju z = 0 → wybuch), wiek
   * wybuchów, flary.
   * @param {object} ctx { rocks: RockLayer gry, origin, box: {x0,y0,x1,y1} świat gry, target (liczba flar) }
   */
  update(dt, time, ctx) {
    this.explosions = this.explosions.filter((e) => time - e.t0 < EXPLOSION_LIFE);
    for (const s of this.shots) {
      // Ruch jednostajny od punktu startu (ten sam zegar co kroki pyłu).
      const age = time - s.t0;
      s.px = s.x; s.py = s.y;
      s.x = s.sx + s.vx * age;
      s.y = s.sy + s.vy * age;
      if (age > SHOT_LIFE) s.alive = false;
    }
    // Trafienie: odcinek lotu przecina koło skały gry (rekordy pola, świat).
    if (ctx.rocks && this.shots.length) {
      ctx.rocks.forEachLoaded((rock) => {
        for (const s of this.shots) {
          if (!s.alive || time - s.t0 < 0.05) continue;
          const r = rock.r * 0.95;
          const ex = s.x - rock.x;
          const ey = s.y - rock.y;
          if (Math.abs(ex) > r + 200 || Math.abs(ey) > r + 200) continue;
          if (ex * ex + ey * ey < r * r) {
            s.alive = false;
            const dx = s.x - s.px;
            const dy = s.y - s.py;
            const l = Math.hypot(dx, dy) || 1;
            // Punkt na brzegu skały od strony nadlotu.
            const bx = s.x - dx / l * Math.max(0, r - Math.hypot(ex, ey));
            const by = s.y - dy / l * Math.max(0, r - Math.hypot(ex, ey));
            this.explode(bx, by, 0.45, time);
          }
        }
      });
    }
    this.shots = this.shots.filter((s) => s.alive);
    this._updateFlares(dt, time, ctx);
    this.stats.explosions = this.explosions.length;
    this.stats.shots = this.shots.length;
    this.stats.flares = this.flares.length;
  }

  _updateFlares(dt, time, ctx) {
    const target = Math.max(0, ctx.flareTarget | 0);
    const b = ctx.box;
    const rng = this.rng;
    // Flary poza pudłem wracają do puli (kamera odleciała).
    for (const f of this.flares) {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      // Flary dryfują w warstwie pyłu (pod płaszczyzną gry).
      if ((f.z > 60 && f.vz > 0) || (f.z < -520 && f.vz < 0)) f.vz = -f.vz;
      const out = f.x < b.x0 || f.x > b.x1 || f.y < b.y0 || f.y > b.y1;
      if (out || time - f.t0 > f.life) f.dead = true;
    }
    this.flares = this.flares.filter((f) => !f.dead);
    while (this.flares.length > target) this.flares.pop();
    let spawn = Math.min(target - this.flares.length, 64);
    while (spawn-- > 0) {
      const c = FLARE_COLORS[Math.floor(rng() * FLARE_COLORS.length)];
      const sp = 20 + rng() * 70;
      const a = rng() * Math.PI * 2;
      this.flares.push({
        x: b.x0 + rng() * (b.x1 - b.x0), y: b.y0 + rng() * (b.y1 - b.y0), z: -480 + rng() * 520,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (rng() - 0.5) * 30,
        color: c, power: 0.22 + rng() * 0.3, range: 300 + rng() * 450,
        t0: time - rng() * 4, life: 7 + rng() * 9, phase: rng() * 10
      });
    }
  }

  /** Światła wybuchów, pocisków, flar i świecących skał (scena). */
  addLights(grid, ox, oy, time, ctx) {
    for (const e of this.explosions) {
      const a = time - e.t0;
      const k = e.power;
      const I = (7.0 * Math.exp(-a / 0.16) + 1.3 * Math.exp(-a / 0.8)) * k;
      if (I < 0.01) continue;
      const range = (900 + 2800 * (1 - Math.exp(-a / 0.3))) * Math.sqrt(Math.max(0.2, k));
      const warm = Math.min(1, a / 0.5);
      grid.add(e.x - ox, -(e.y - oy), 80, range, I, I * (0.82 - 0.25 * warm), I * (0.62 - 0.4 * warm), 1.0);
    }
    for (const s of this.shots) {
      grid.add(s.x - ox, -(s.y - oy), 20, 760, 1.2, 1.9, 2.6, 0.9);
    }
    // Światło dysz: niebieska plazma za rufą, w pyle rozświetla strugę.
    let engines = 0;
    for (const hull of ctx.hulls) {
      if (!hull || hull.thrust < 0.02) continue;
      const c = Math.cos(hull.angle);
      const s = Math.sin(hull.angle);
      const bx = hull.x - c * hull.length * 0.62;
      const by = hull.y - s * hull.length * 0.62;
      const t = hull.thrust;
      // W pyle dysza świeci umiarkowanie (przy 0,9 łuna za rufą zalewała pół kadru).
      grid.add(bx - ox, -(by - oy), 30, 700 + 1500 * t, 0.45 * t, 0.85 * t, 1.9 * t, 0.18);
      engines++;
    }
    this.stats.engineLights = engines;
    // Świecące skały (każda przy kadrze = światło), moc rośnie z mrokiem pola.
    let rockLights = 0;
    if (ctx.rockLights && ctx.rocks) {
      const b = ctx.box;
      ctx.rocks.forEachLoaded((rock) => {
        const col = GLOW_ROCK[rock.type];
        if (!col || rock.r < 60) return;
        if (rock.x < b.x0 || rock.x > b.x1 || rock.y < b.y0 || rock.y > b.y1) return;
        const dark = ctx.sunOcc ? 1 - ctx.sunT(rock.x, rock.y) : 0;
        const size = Math.min(1.4, Math.max(0.45, Math.sqrt(rock.r / 400)));
        let I = 0.75 * size * (0.3 + 0.7 * dark);
        if (rock.type === 8) I *= 0.7 + 0.3 * Math.sin(time * (1.1 + (rock.seed * 7.1 % 1) * 1.4) + rock.seed * 43.7);
        // W pyle skała świeci lekko (halo wokół bryły) — przy 0,5 skały energetyczne
        // burzy zalewały fioletem cały ośrodek.
        if (grid.add(rock.x - ox, -(rock.y - oy), rock.r * 0.25, Math.min(2600, rock.r * 4 + 400), col[0] * I, col[1] * I, col[2] * I, rock.type === 8 ? 0.1 : 0.12) >= 0) rockLights++;
      });
    }
    this.stats.rockLights = rockLights;
    for (const f of this.flares) {
      const a = time - f.t0;
      const env = Math.min(1, a / 1.2) * Math.min(1, (f.life - a) / 1.5);
      const flick = 0.85 + 0.15 * Math.sin(time * 9 + f.phase) * Math.sin(time * 5.3 + f.phase * 2);
      const I = f.power * FLARE_LIGHT * Math.max(0, env) * flick;
      // W pyle flara tylko lekko (setki flar rozlewały światło na cały ośrodek).
      grid.add(f.x - ox, -(f.y - oy), f.z, f.range, f.color[0] * I, f.color[1] * I, f.color[2] * I, 0.02);
    }
  }

  /** Duszki: jądra wybuchów, głowice pocisków, flary. */
  addGlows(glow, ox, oy, time) {
    for (const e of this.explosions) {
      const a = time - e.t0;
      const k = Math.exp(-a / 0.2) * e.power;
      if (k > 0.01) glow.add(e.x - ox, -(e.y - oy), 12, 260 * (0.6 + a * 2.5) * Math.sqrt(e.power), 7 * k, 4.6 * k, 2.6 * k, GLOW_ROUND);
    }
    for (const s of this.shots) {
      const sp = Math.hypot(s.vx, s.vy) || 1;
      glow.add(s.x - ox, -(s.y - oy), 14, 34, 2.4, 4.2, 6.5, GLOW_STREAK, s.vx / sp, -s.vy / sp, 7);
    }
    for (const f of this.flares) {
      const a = time - f.t0;
      const env = Math.max(0, Math.min(1, a / 1.2) * Math.min(1, (f.life - a) / 1.5));
      // Flara pod płaszczyzną (z < 0) — w mgle i pyle, blask słabszy.
      const k = FLARE_GLOW * env * f.power * (f.z < 0 ? 0.6 : 1);
      glow.add(f.x - ox, -(f.y - oy), f.z, 16, f.color[0] * k, f.color[1] * k, f.color[2] * k, GLOW_ROUND);
    }
  }
}
