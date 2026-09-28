// src/vfx/canvasParticleSystem.js

import { SimClock, CLOCK_RENDER, CLOCK_SIM } from '../game/simClock.js';
import { ActiveCarrier } from '../game/carrierVelocity.js';
// Losowość warstwy efektów (zadanie 23): wizualia nie zużywają Math.random gry — przebieg rozgrywki nie zależy od obrazu.
import { fxRandom } from '../3d/fx/fxRandom.js';

// NOSNIK (src/game/carrierVelocity.js): czastka, blysk i fala rodza sie
// z predkoscia kadluba, z ktorego wyszly, i rysuja sie w  pos + v * (T - t0)
// z zegara gry. Ruch i opor wlasny czastki (update) dzialaja WZGLEDEM nosnika —
// dym z lufy pedzacego okretu wyglada jak na postoju. Nosnik ustawia wolajacy
// na czas serii spawnow (ActiveCarrier / setCarrier); domyslnie zero = jak dawniej.
const _carrier = ActiveCarrier;

// Czas lotu z nośnikiem (T − t0). Obiekt bez pól nośnika (np. fala dopisana
// z zewnątrz) dostaje 0 — NaN razy zerowa prędkość to dalej NaN.
function carrierElapsed(clock, t0) {
  if (typeof t0 !== 'number' || !(t0 === t0)) return 0;
  return (clock === CLOCK_RENDER ? SimClock.render : SimClock.sim) - t0;
}

// Rzutowanie bez alokacji. window.worldToScreen oddaje SWIEZY obiekt na kazde
// wywolanie, a ta warstwa wola je tysiace razy na klatke (budzet 4500 czastek
// + 2 rzuty na pocisk). Kazdy scratch nalezy do jednej petli i nie przezywa
// wywolania, ktore go uzywa — dlatego pocisk, potrzebujacy pozycji BIEZACEJ
// i POPRZEDNIEJ naraz, dostaje dwa osobne.
const _sScratch = { x: 0, y: 0 };
const _prevScratch = { x: 0, y: 0 };
const _pScratch = { x: 0, y: 0 };
// Smuga pocisku kanwy = ruch wzgledem strzelca w tym czasie (jak w 3D).
const BULLET_STREAK_DT = 1 / 120;

function projectInto(wx, wy, cam, out) {
  const fn = (typeof window !== 'undefined') ? window.worldToScreenInto : null;
  if (fn) return fn(wx, wy, cam, out);
  const s = window.worldToScreen(wx, wy, cam);
  out.x = s.x;
  out.y = s.y;
  return out;
}

export const CanvasVFX = {
  enabled: true,
  MAX_PARTICLES: 8000,
  MAX_PARTICLES_DRAW: 4500,
  
  particlePool: [],
  activeParticles: [],
  nextParticleIndex: 0,
  shockwaves: [],
  lightningParticles: [],

  WEAPON_VFX_PRESETS: {
    rail: { color: '#9cc9ff', len: 32, widthOuter: 12, widthInner: 4, glowBlur: 22, sparkCount: 18, sparkSpeed: [260, 420], sparkSize: [1.6, 2.4], shock: { r: 12, maxR: 120, w: 3.0, life: 0.32 } },
    tempest: { color: '#00ccff', len: 30, widthOuter: 14, widthInner: 4.5, glowBlur: 26, sparkCount: 24, sparkSpeed: [260, 460], sparkSize: [1.4, 2.8], shock: { r: 14, maxR: 140, w: 3.2, life: 0.34 } },
    vulcan: { color: '#ffaa00', len: 14, widthOuter: 8, widthInner: 2.8, glowBlur: 14, sparkCount: 10, sparkSpeed: [220, 360], sparkSize: [1.1, 1.8], shock: { r: 7, maxR: 64, w: 2.0, life: 0.18 } },
    helios: { color: '#ff003c', len: 36, widthOuter: 10, widthInner: 2.8, glowBlur: 26, sparkCount: 18, sparkSpeed: [240, 380], sparkSize: [1.2, 2.2], shock: { r: 12, maxR: 120, w: 2.8, life: 0.28 } },
    armata: { color: '#ffb46b', len: 34, widthOuter: 18, widthInner: 6, glowBlur: 26, sparkCount: 26, sparkSpeed: [240, 420], sparkSize: [2.2, 3.4], smoke: 6, smokeColor: 'rgba(120,90,60,0.55)', shock: { r: 16, maxR: 150, w: 3.6, life: 0.4 } },
    autocannon: { color: '#ffcc8a', len: 18, widthOuter: 10, widthInner: 4, glowBlur: 18, sparkCount: 14, sparkSpeed: [220, 360], sparkSize: [1.4, 2.4], smoke: 4, smokeColor: 'rgba(90,110,180,0.5)', shock: { r: 10, maxR: 90, w: 2.8, life: 0.26 } },
    plasma: { color: '#7cff9c', len: 20, widthOuter: 10, widthInner: 6, glowBlur: 18, trailFromPrev: true, sparkCount: 14, sparkSpeed: [180, 320], sparkSize: [1.4, 2.4], shock: { r: 12, maxR: 110, w: 2.8, life: 0.3 } },
    pulse: { color: '#ffd36e', len: 22, widthOuter: 12, widthInner: 6, glowBlur: 20, trailFromPrev: true, sparkCount: 16, sparkSpeed: [200, 360], sparkSize: [1.6, 2.6], shock: { r: 12, maxR: 130, w: 3.0, life: 0.32 } },
    laser: { color: '#86f7ff', len: 28, widthOuter: 11, widthInner: 3.5, glowBlur: 24, sparkCount: 12, sparkSpeed: [220, 360], sparkSize: [1.2, 2.0], shock: { r: 10, maxR: 100, w: 2.4, life: 0.26 } },
    beam: { color: '#ff7c7c', len: 30, widthOuter: 12, widthInner: 5, glowBlur: 26, sparkCount: 16, sparkSpeed: [260, 380], sparkSize: [1.6, 2.8], shock: { r: 16, maxR: 160, w: 3.4, life: 0.36 } },
    flak: { color: '#ffef8a', len: 20, widthOuter: 14, widthInner: 6, glowBlur: 22, sparkCount: 22, sparkSpeed: [200, 360], sparkSize: [1.6, 3.0], smoke: 8, smokeColor: 'rgba(120,90,60,0.4)', shock: { r: 18, maxR: 170, w: 3.8, life: 0.42 } },
    broadside: { color: '#ff9b4b', len: 24, widthOuter: 14, widthInner: 6, glowBlur: 22, sparkCount: 20, sparkSpeed: [220, 360], sparkSize: [1.8, 2.8], smoke: 5, smokeColor: 'rgba(120,80,60,0.45)', shock: { r: 16, maxR: 160, w: 3.4, life: 0.4 } },
    ciws: { color: '#8cffd0', len: 14, widthOuter: 8, widthInner: 3, glowBlur: 14, sparkCount: 10, sparkSpeed: [180, 280], sparkSize: [1.0, 1.8], shock: { r: 8, maxR: 70, w: 2.0, life: 0.2 } },
    torpedo: { color: '#ff4444', len: 40, widthOuter: 22, widthInner: 8, glowBlur: 34, sparkCount: 32, sparkSpeed: [180, 480], sparkSize: [2.4, 4.2], smoke: 12, smokeColor: 'rgba(160,80,40,0.6)', shock: { r: 28, maxR: 280, w: 5.0, life: 0.6 } },
    siege: { color: '#aaffff', len: 50, widthOuter: 26, widthInner: 10, glowBlur: 40, sparkCount: 40, sparkSpeed: [300, 600], sparkSize: [3.0, 5.0], smoke: 8, smokeColor: 'rgba(140,200,255,0.45)', shock: { r: 36, maxR: 400, w: 6.0, life: 0.8 } },
    superweapon: { color: '#d0eaff', len: 60, widthOuter: 30, widthInner: 12, glowBlur: 48, sparkCount: 48, sparkSpeed: [280, 550], sparkSize: [3.2, 5.5], smoke: 10, smokeColor: 'rgba(180,220,255,0.5)', shock: { r: 40, maxR: 500, w: 7.0, life: 1.0 } },
    default: { color: '#ffd86b', len: 18, widthOuter: 10, widthInner: 4, glowBlur: 18, sparkCount: 14, sparkSpeed: [200, 320], sparkSize: [1.2, 2.0], shock: { r: 10, maxR: 100, w: 2.6, life: 0.3 } },
  },

  init() {
    this.enabled = window.CANVAS_WEAPON_VFX_ENABLED !== false;
    this.activeParticles = [];
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particlePool.push({
        pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, life: 0, age: 0, color: '#fff', size: 1, flash: false, active: false,
        _activeIdx: -1,
        // nosnik: predkosc (swiat gry), czas pozy, zegar
        cvx: 0, cvy: 0, ct0: 0, clock: CLOCK_SIM
      });
    }
  },

  /**
   * Nosnik kolejnych spawnow: { vx, vy, t0, clock } (src/game/carrierVelocity.js).
   * Wolajacy zdejmuje go clearCarrier() po serii — inaczej nastepny efekt
   * polecialby z cudza predkoscia.
   */
  setCarrier(carrier) { ActiveCarrier.set(carrier); },

  clearCarrier() { ActiveCarrier.clear(); },

  hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    const clean = hex.replace('#', '');
    if (clean.length === 3) return { r: parseInt(clean[0]+clean[0], 16), g: parseInt(clean[1]+clean[1], 16), b: parseInt(clean[2]+clean[2], 16) };
    if (clean.length !== 6) return null;
    return { r: parseInt(clean.slice(0, 2), 16), g: parseInt(clean.slice(2, 4), 16), b: parseInt(clean.slice(4, 6), 16) };
  },
  
  rgbaFromHex(hex, alpha) {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return null;
    return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
  },

  rgbaPrefixFromHex(hex, fallback = 'rgba(255,200,150,') {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return fallback;
    return `rgba(${rgb.r},${rgb.g},${rgb.b},`;
  },

  resolveAlphaColor(color, alpha, fallback) {
    const rgba = this.rgbaFromHex(color, alpha);
    if (rgba) return rgba;
    if (color?.startsWith('rgba(')) {
      const parts = color.split(',');
      if (parts.length >= 3) return `${parts[0]},${parts[1]},${parts[2]},${alpha})`;
    }
    return fallback || color || '#ffffff';
  },

  isWorldPointNearViewport(wx, wy, marginPx = 240) {
    if (!window.camera || typeof window.worldToScreen !== 'function') return true;
    const s = window.worldToScreen(wx, wy, window.camera);
    return s.x >= -marginPx && s.x <= (window.W + marginPx) && s.y >= -marginPx && s.y <= (window.H + marginPx);
  },

  spawnParticle(pos, vel, life, color, size, flash) {
    CanvasVFX.spawnParticleXY(pos.x, pos.y, vel.x, vel.y, life, color, size, flash);
  },

  // Wariant bez obiektów {x,y} — smugi pocisków idą setkami na klatkę, a każde
  // wywołanie spawnParticle budowało dwa obiekty tylko po to, by je skopiować.
  spawnParticleXY(x, y, vx, vy, life, color, size, flash) {
    const p = CanvasVFX.particlePool[CanvasVFX.nextParticleIndex];
    if (p.active) {
      const idx = p._activeIdx;
      const last = CanvasVFX.activeParticles[CanvasVFX.activeParticles.length - 1];
      CanvasVFX.activeParticles[idx] = last;
      last._activeIdx = idx;
      CanvasVFX.activeParticles.pop();
    }
    p.pos.x = x; p.pos.y = y; p.vel.x = vx; p.vel.y = vy;
    p.life = life; p.age = 0; p.color = color || '#ffb677'; p.size = size || 2;
    p.flash = !!flash; p.active = true;
    p.cvx = _carrier.vx; p.cvy = _carrier.vy; p.ct0 = _carrier.t0; p.clock = _carrier.clock;
    p._activeIdx = CanvasVFX.activeParticles.length;
    CanvasVFX.activeParticles.push(p);
    CanvasVFX.nextParticleIndex = (CanvasVFX.nextParticleIndex + 1) % CanvasVFX.MAX_PARTICLES;
  },

  spawnShockwave(x, y, opts = {}) {
    // Hard cap to prevent unbounded growth
    if (CanvasVFX.shockwaves.length >= 48) CanvasVFX.shockwaves.shift();
    CanvasVFX.shockwaves.push({
      x, y, r: opts.r || 20, maxR: opts.maxR || 800, w: opts.w || 8,
      life: 0, maxLife: opts.maxLife || 0.6, color: opts.color || 'rgba(180,200,255,',
      cvx: _carrier.vx, cvy: _carrier.vy, ct0: _carrier.t0, clock: _carrier.clock
    });
  },

  spawnLightningSpark(pos, life, size, angle) {
    if (!CanvasVFX.enabled) return;
    if (CanvasVFX.lightningParticles.length >= 80) CanvasVFX.lightningParticles.shift();
    CanvasVFX.lightningParticles.push({
      x: pos.x, y: pos.y, life: life, maxLife: life, size: size, angle: angle, age: 0,
      cvx: _carrier.vx, cvy: _carrier.vy, ct0: _carrier.t0, clock: _carrier.clock
    });
  },

  resolveBulletVfxKey(rawKey, type) {
    const key = (rawKey || '').toString().toLowerCase();
    if (key.includes('broadside')) return 'broadside';
    if (key.includes('flak')) return 'flak';
    if (key.includes('vulcan')) return 'vulcan';
    if (key.includes('helios')) return 'helios';
    if (key.includes('tempest') || key === 'railgun_mk1' || key === 'railgun_mk2') return 'tempest';
    if (key.includes('beam') || key.includes('laser')) return key.includes('heavy') ? 'beam' : 'laser';
    if (key.includes('rail')) return 'rail';
    if (key.includes('armata')) return 'armata';
    if (key.includes('auto') || key.includes('gatling')) return 'autocannon';
    if (key.includes('pulse')) return 'pulse';
    if (key.includes('pd')) return 'ciws';
    if (key.includes('siege_torpedo') || key.includes('torpedo_salvo')) return 'torpedo';
    if (key.includes('siege_railgun') || key.includes('mjolnir')) return 'siege';
    if (key.includes('hexlance')) return 'superweapon';
    if (key.includes('missile') || key.includes('aim-') || key.includes('asm') || key.includes('het') || key.includes('swarm')) return 'armata';
    if (type === 'torpedo') return 'torpedo';
    if (type === 'beam') return 'beam';
    if (type === 'rail') return 'rail';
    if (type === 'armata') return 'armata';
    if (type === 'ciws') return 'ciws';
    if (type === 'autocannon') return 'autocannon';
    if (type === 'plasma') return 'plasma';
    if (type === 'rocket') return 'armata';
    if (type === 'flak') return 'flak';
    if (type === 'superweapon') return 'superweapon';
    return 'default';
  },

  buildBulletVfxInstance(presetKey, color) {
    const preset = this.WEAPON_VFX_PRESETS[presetKey] || this.WEAPON_VFX_PRESETS.default;
    const resolvedColor = color || preset.color;
    return { ...preset, key: preset.key, color: resolvedColor, glowColor: preset.glowColor || resolvedColor, trailColor: preset.trailColor || resolvedColor, shockColorPrefix: this.rgbaPrefixFromHex(preset.shockColor || resolvedColor, 'rgba(255,200,150,') };
  },

  // Wybuch 3D przy śmierci NPC / platformy (spawnExplosionPlasma, spawnDefaultHit): wybuch drona
  // z dema bronie-webgpu (WeaponFx.droneBlast, zadanie 17 — dawniej fabryka trafienia działka
  // w overlayu przez spawnProjectileImpact3D, usunięta z fabrykami trafień). Rozmiar jak dawniej.
  _spawnDeathBlast3D(x, y, scale) {
    const fx = typeof window !== 'undefined' ? window.WeaponFx : null;
    if (!fx || !fx.available || !this.isWorldPointNearViewport(x, y, 260)) return;
    const h = window.ship?.h || 250;
    fx.droneBlast(x, y, h * 0.18 * Math.max(0.7, scale));
  },

  spawnExplosionPlasma(x, y, scale = 1) {
    this._spawnDeathBlast3D(x, y, scale);
    if (!this.enabled) return;
    this.spawnParticle({ x, y }, { x: 0, y: 0 }, 0.1, '#AAFFAA', 4 * scale, true);
    this.spawnShockwave(x, y, { r: 2, maxR: 14 * scale, w: 2, maxLife: 0.15, color: 'rgba(124, 255, 124,' });
  },

  spawnDefaultHit(x, y, scale = 1) {
    this._spawnDeathBlast3D(x, y, scale);
    if (!this.enabled) return;
    this.spawnParticle({ x, y }, { x: 0, y: 0 }, 0.15, '#fff5d6', 7 * scale, true);
    this.spawnShockwave(x, y, { r: 4 * scale, maxR: 45 * scale, w: 3 * scale, maxLife: 0.25, color: 'rgba(255, 220, 180,' });
  },

  update(dt) {
    // Backwards loop: swap-delete nie powoduje pomijania elementów
    for (let i = this.activeParticles.length - 1; i >= 0; i--) {
      const p = this.activeParticles[i];
      p.age += dt;
      if (p.age >= p.life) {
        const last = this.activeParticles[this.activeParticles.length - 1];
        this.activeParticles[i] = last;
        last._activeIdx = i;
        this.activeParticles.pop();
        p.active = false;
        continue;
      }
      p.vel.x *= 0.98; p.vel.y *= 0.98; p.vel.y += 8 * dt;
      p.pos.x += p.vel.x * dt; p.pos.y += p.vel.y * dt;
    }
    if (this.enabled) {
      for (let i = this.lightningParticles.length - 1; i >= 0; i--) {
        const p = this.lightningParticles[i];
        p.age += dt;
        if (p.age >= p.maxLife) this.lightningParticles.splice(i, 1);
      }
    } else {
      this.lightningParticles.length = 0;
    }
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.life += dt;
      const k = Math.min(1, s.life / s.maxLife);
      s.r = s.maxR * k;
      s.w = Math.max(1, (1 - k) * (s.maxR * 0.06));
      if (s.life >= s.maxLife) this.shockwaves.splice(i, 1);
    }
  },

  drawParticles(ctx, cam) {
    ctx.save();
    let drawn = 0;
    const vw = window.W || ctx.canvas.width;
    const vh = window.H || ctx.canvas.height;
    const s = _pScratch;
    for (const p of this.activeParticles) {
      if (p.flash) continue;
      // ODRZUTY PRZED BUDZETEM. Wczesniej `drawn++` szlo przed testem kadru, wiec
      // eksplozja poza ekranem wyczerpywala limit 4500 i wycinala czastki, ktore
      // gracz naprawde widzi. Kolejnosc: najtanszy test (rozmiar) -> rzut -> kadr
      // -> dopiero budzet.
      const size = p.size * cam.zoom;
      if (size < 0.8) continue;
      const ce = carrierElapsed(p.clock, p.ct0);
      projectInto(p.pos.x + (p.cvx ? p.cvx * ce : 0), p.pos.y + (p.cvy ? p.cvy * ce : 0), cam, s);
      if (s.x < -10 || s.x > vw + 10 || s.y < -10 || s.y > vh + 10) continue;
      if (drawn >= this.MAX_PARTICLES_DRAW) break;
      drawn++;
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - p.age / p.life));
      ctx.fillStyle = p.color;
      ctx.fillRect(s.x - size * 0.5, s.y - size * 0.5, size, size);
    }
    ctx.restore();
  },

  drawFlashes(ctx, cam) {
    ctx.save();
    let drawn = 0;
    const vw = window.W || ctx.canvas.width;
    const vh = window.H || ctx.canvas.height;
    const s = _pScratch;
    for (const p of this.activeParticles) {
      if (!p.flash) continue;
      // Patrz drawParticles: budzet konsumuja tylko blyski faktycznie rysowane.
      const ce = carrierElapsed(p.clock, p.ct0);
      projectInto(p.pos.x + (p.cvx ? p.cvx * ce : 0), p.pos.y + (p.cvy ? p.cvy * ce : 0), cam, s);
      if (s.x < -50 || s.x > vw + 50 || s.y < -50 || s.y > vh + 50) continue;
      if (drawn >= this.MAX_PARTICLES_DRAW) break;
      drawn++;
      const t = Math.max(0, Math.min(1, 1 - p.age / p.life));
      const size = p.size * cam.zoom;
      ctx.globalAlpha = t * 0.3;
      ctx.fillStyle = p.color;
      ctx.fillRect(s.x - size * 2, s.y - size * 2, size * 4, size * 4);
      ctx.globalAlpha = t;
      ctx.fillRect(s.x - size * 0.5, s.y - size * 0.5, size, size);
    }
    ctx.restore();
  },

  drawLightnings(ctx, cam) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    const vw = window.W || ctx.canvas.width;
    const vh = window.H || ctx.canvas.height;
    const s = _pScratch;
    for (const p of this.lightningParticles) {
      const t = 1 - (p.age / p.maxLife);
      const ce = carrierElapsed(p.clock, p.ct0);
      projectInto(p.x + (p.cvx ? p.cvx * ce : 0), p.y + (p.cvy ? p.cvy * ce : 0), cam, s);
      if (s.x < -50 || s.x > vw + 50 || s.y < -50 || s.y > vh + 50) continue;
      ctx.strokeStyle = `rgba(180, 240, 255, ${t * 0.8})`;
      ctx.lineWidth = (1 + fxRandom.next()) * cam.zoom;
      const len = p.size * t * 2.0 * cam.zoom;
      const ax = Math.cos(p.angle) * len;
      const ay = Math.sin(p.angle) * len;
      const x1 = s.x - ax * 0.5, y1 = s.y - ay * 0.5;
      const x2 = s.x + ax * 0.5, y2 = s.y + ay * 0.5;
      ctx.beginPath(); ctx.moveTo(x1, y1);
      const segments = 3;
      for (let i = 1; i <= segments; i++) {
        const progress = i / segments;
        const tx = x1 + (x2 - x1) * progress;
        const ty = y1 + (y2 - y1) * progress;
        const noise = (fxRandom.next() - 0.5) * p.size * 0.4 * t * cam.zoom;
        if (i < segments) ctx.lineTo(tx - Math.sin(p.angle) * noise, ty + Math.cos(p.angle) * noise);
        else ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    ctx.restore();
  },

  drawShockwaves(ctx, cam) {
    for (const s of this.shockwaves) {
      const ce = carrierElapsed(s.clock, s.ct0);
      const sw = window.worldToScreen(s.x + (s.cvx ? s.cvx * ce : 0), s.y + (s.cvy ? s.cvy * ce : 0), cam);
      ctx.beginPath();
      ctx.lineWidth = s.w * cam.zoom;
      ctx.strokeStyle = s.color + Math.max(0, 1 - s.life / s.maxLife) + ')';
      ctx.arc(sw.x, sw.y, s.r * cam.zoom, 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  drawBulletVisual(ctx, b, cam, alpha = 1) {
    if (!this.enabled) return;
    if (!b.vfx) b.vfx = this.buildBulletVfxInstance(this.resolveBulletVfxKey(b.vfxKey || b.weaponId || b.weaponName, b.type), b.vfxColor || b.color);
    const vfx = b.vfx;
    const rx = (typeof b.px === 'number') ? b.px + (b.x - b.px) * alpha : b.x;
    const ry = (typeof b.py === 'number') ? b.py + (b.y - b.py) * alpha : b.y;
    const s = projectInto(rx, ry, cam, _sScratch);
    // Smuga i orientacja z ruchu WZGLĘDEM strzelca (ivx/ivy = prędkość odziedziczona
    // przy strzale): pocisk z pędzącego okrętu wygląda jak z nieruchomego.
    const svx = (Number(b.vx) || 0) - (Number(b.ivx) || 0);
    const svy = (Number(b.vy) || 0) - (Number(b.ivy) || 0);
    const prevS = projectInto(rx - svx * BULLET_STREAK_DT, ry - svy * BULLET_STREAK_DT, cam, _prevScratch);
    const angle = (svx !== 0 || svy !== 0) ? Math.atan2(svy, svx) : Math.atan2(b.vy, b.vx);
    const lenPx = (vfx.len || 50) * cam.zoom;

    // Pociski poza kadrem: petla rysujaca leci po WSZYSTKICH pociskach swiata,
    // wiec strzelanina NPC vs NPC po drugiej stronie mapy placila tu za save/
    // restore, gradienty i budowe sciezek. Kanwa i tak by je przycieła, ale
    // dopiero na koncu potoku. AABB odcinka (prevS -> s) z zapasem na najgrubszy
    // rysowany ksztalt: torpeda ma poswiate silnika okolo 68*zoom od srodka.
    const _cullMargin = Math.max(64, lenPx + 80 * cam.zoom);
    const _vw = window.W || ctx.canvas.width;
    const _vh = window.H || ctx.canvas.height;
    if (
      Math.max(s.x, prevS.x) + _cullMargin < 0 ||
      Math.max(s.y, prevS.y) + _cullMargin < 0 ||
      Math.min(s.x, prevS.x) - _cullMargin > _vw ||
      Math.min(s.y, prevS.y) - _cullMargin > _vh
    ) return;

    if (b.type === 'torpedo') {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(angle);
      const torpLen = Math.max(12, 60 * cam.zoom);
      const torpW = Math.max(4, 16 * cam.zoom);
      // Body
      ctx.fillStyle = '#cc3333';
      ctx.strokeStyle = '#ff6644';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(torpLen * 0.6, 0);
      ctx.lineTo(-torpLen * 0.4, torpW * 0.5);
      ctx.lineTo(-torpLen * 0.5, torpW * 0.3);
      ctx.lineTo(-torpLen * 0.5, -torpW * 0.3);
      ctx.lineTo(-torpLen * 0.4, -torpW * 0.5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Engine glow
      const engineGrad = ctx.createRadialGradient(-torpLen * 0.5, 0, 0, -torpLen * 0.5, 0, torpW * 2);
      engineGrad.addColorStop(0, 'rgba(255,180,60,0.9)');
      engineGrad.addColorStop(0.5, 'rgba(255,100,30,0.4)');
      engineGrad.addColorStop(1, 'rgba(255,50,0,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = engineGrad;
      ctx.beginPath(); ctx.arc(-torpLen * 0.5, 0, torpW * 2, 0, Math.PI * 2); ctx.fill();
      // Warhead glow
      const headGrad = ctx.createRadialGradient(torpLen * 0.5, 0, 0, torpLen * 0.5, 0, torpW);
      headGrad.addColorStop(0, 'rgba(255,100,100,0.6)');
      headGrad.addColorStop(1, 'rgba(255,0,0,0)');
      ctx.fillStyle = headGrad;
      ctx.beginPath(); ctx.arc(torpLen * 0.5, 0, torpW, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }

    if (b.type === 'rail') {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(angle);
      // Clean straight bolt: soft outer glow + bright core, no round head blob.
      const width = (vfx.widthInner || 3) * cam.zoom;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.strokeStyle = this.resolveAlphaColor(vfx.trailColor || vfx.color, 0.5, vfx.color);
      ctx.lineWidth = width * 2.2;
      ctx.beginPath(); ctx.moveTo(-lenPx / 2, 0); ctx.lineTo(lenPx / 2, 0); ctx.stroke();
      const coreGrad = ctx.createLinearGradient(-lenPx / 2, 0, lenPx / 2, 0);
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.55)'); coreGrad.addColorStop(1, 'rgba(255, 255, 255, 1.0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath(); ctx.roundRect(-lenPx / 2, -width / 2, lenPx, width, width / 2); ctx.fill();
      if (fxRandom.next() < 0.3) this.spawnLightningSpark({ x: rx + (fxRandom.next()-0.5)*10, y: ry + (fxRandom.next()-0.5)*10 }, 0.3, 18, fxRandom.next() * Math.PI * 2);
      ctx.restore();
      return;
    }

    const dx = Math.cos(angle) * (lenPx * 0.5), dy = Math.sin(angle) * (lenPx * 0.5);
    if (vfx.trailFromPrev) {
      const grad = ctx.createLinearGradient(prevS.x, prevS.y, s.x, s.y);
      grad.addColorStop(0, this.resolveAlphaColor(vfx.trailColor, 0, vfx.color));
      grad.addColorStop(1, this.resolveAlphaColor(vfx.trailColor, 0.8, vfx.color));
      ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = grad; ctx.lineWidth = Math.max(1.2, (vfx.widthOuter || 8) * 0.6 * cam.zoom);
      ctx.beginPath(); ctx.moveTo(prevS.x, prevS.y); ctx.lineTo(s.x, s.y); ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = this.resolveAlphaColor(vfx.trailColor, 0.75, vfx.color); ctx.lineWidth = (vfx.widthOuter || 10) * cam.zoom;
    ctx.beginPath(); ctx.moveTo(s.x - dx, s.y - dy); ctx.lineTo(s.x + dx, s.y + dy); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.lineCap = 'round'; ctx.strokeStyle = this.resolveAlphaColor('#ffffff', 0.95, vfx.color); ctx.lineWidth = Math.max(1.2, (vfx.widthInner || 4) * cam.zoom);
    ctx.beginPath(); ctx.moveTo(s.x - dx * 0.35, s.y - dy * 0.35); ctx.lineTo(s.x + dx * 0.9, s.y + dy * 0.9); ctx.stroke(); ctx.restore();
  }
};
