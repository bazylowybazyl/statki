// src/vfx/canvasParticleSystem.js

export const CanvasVFX = {
  enabled: true,
  MAX_PARTICLES: 8000,
  MAX_PARTICLES_DRAW: 4500,
  
  particlePool: [],
  nextParticleIndex: 0,
  shockwaves: [],
  lightningParticles: [],
  projectileImpact3DThrottle: new Map(),

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
    for (let i = 0; i < this.MAX_PARTICLES; i++) {
      this.particlePool.push({
        pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, life: 0, age: 0, color: '#fff', size: 1, flash: false, beam: false,
        start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, width: 0, alpha: 1, fadeWithLife: true,
        glowColor: null, colorOuter: null, colorInner: null, glowBlur: 0, outerWidthMul: 1, innerWidthMul: 1, active: false
      });
    }
  },

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
    const p = CanvasVFX.particlePool[CanvasVFX.nextParticleIndex];
    p.pos.x = pos.x; p.pos.y = pos.y; p.vel.x = vel.x; p.vel.y = vel.y;
    p.life = life; p.age = 0; p.color = color || '#ffb677'; p.size = size || 2;
    p.flash = !!flash; p.beam = false; p.alpha = 1; p.fadeWithLife = true;
    p.colorOuter = null; p.colorInner = null; p.glowColor = null; p.glowBlur = 0;
    p.outerWidthMul = 1; p.innerWidthMul = 1; p.active = true;
    CanvasVFX.nextParticleIndex = (CanvasVFX.nextParticleIndex + 1) % CanvasVFX.MAX_PARTICLES;
  },

  spawnShockwave(x, y, opts = {}) {
    // Hard cap to prevent unbounded growth
    if (CanvasVFX.shockwaves.length >= 48) CanvasVFX.shockwaves.shift();
    CanvasVFX.shockwaves.push({
      x, y, r: opts.r || 20, maxR: opts.maxR || 800, w: opts.w || 8,
      life: 0, maxLife: opts.maxLife || 0.6, color: opts.color || 'rgba(180,200,255,'
    });
  },

  spawnLightningSpark(pos, life, size, angle) {
    if (!CanvasVFX.enabled) return;
    if (CanvasVFX.lightningParticles.length >= 80) CanvasVFX.lightningParticles.shift();
    CanvasVFX.lightningParticles.push({ x: pos.x, y: pos.y, life: life, maxLife: life, size: size, angle: angle, age: 0 });
  },

  spawnLaserBeam(start, end, width, opts = {}) {
    if (!CanvasVFX.enabled) return;
    const p = CanvasVFX.particlePool[CanvasVFX.nextParticleIndex];
    p.pos.x = start.x; p.pos.y = start.y; p.vel.x = 0; p.vel.y = 0;
    p.life = opts?.life ?? 0.12; p.age = 0; p.flash = false; p.beam = true;
    p.start.x = start.x; p.start.y = start.y; p.end.x = end.x; p.end.y = end.y;
    p.width = width; p.alpha = opts?.alpha ?? 1;
    p.fadeWithLife = opts?.fadeWithLife; p.colorOuter = opts?.colorOuter ?? null;
    p.colorInner = opts?.colorInner ?? null; p.glowColor = opts?.glowColor ?? null;
    p.glowBlur = opts?.glowBlur ?? 0; p.outerWidthMul = opts?.outerWidthMul ?? 1;
    p.innerWidthMul = opts?.innerWidthMul ?? 1; p.size = 0; p.color = '#fff'; p.active = true;
    CanvasVFX.nextParticleIndex = (CanvasVFX.nextParticleIndex + 1) % CanvasVFX.MAX_PARTICLES;
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

  getProjectileImpactVfxPressure() {
    const overlayStats = (typeof window !== 'undefined' && window.overlay3D && typeof window.overlay3D.getStats === 'function') ? window.overlay3D.getStats() : null;
    const active = Number(overlayStats?.activeEffects) || 0;
    const renderMs = Number(overlayStats?.lastRenderMs) || 0;
    const dropped = Number(overlayStats?.droppedEffects) || 0;
    return { active, renderMs, pressure: Math.max(Math.max(0, active / 180), Math.max(0, renderMs / 10), Math.max(0, dropped > 0 ? 0.35 : 0)) };
  },

  resolveImpactColorInt(color, fallback = 0xb0f2ff) {
    const rgb = this.hexToRgb(color);
    if (!rgb) return fallback;
    return ((rgb.r & 255) << 16) | ((rgb.g & 255) << 8) | (rgb.b & 255);
  },

  shouldSpawnProjectileImpact3D(presetKey, x, y) {
    const key = String(presetKey || 'default').toLowerCase();
    const pressure = this.getProjectileImpactVfxPressure().pressure;
    let cooldownMs = 0;
    if (key === 'autocannon' || key === 'ciws' || key === 'vulcan') cooldownMs = 42;
    else if (key === 'plasma' || key === 'pulse' || key === 'default') cooldownMs = 28;
    else if (key === 'rail' || key === 'tempest') cooldownMs = 8;
    else if (key === 'helios') cooldownMs = 34;

    if (pressure > 0.65) {
      if (['autocannon', 'ciws', 'vulcan', 'default', 'plasma', 'pulse'].includes(key)) { if (Math.random() < Math.min(0.9, (pressure - 0.5) * 1.05)) return false; }
      else if (key === 'helios') { if (Math.random() < Math.min(0.75, (pressure - 0.55) * 0.85)) return false; }
    }
    if (pressure > 0.5) cooldownMs *= Math.min(3.4, 1 + (pressure - 0.45) * 2.1);
    if (cooldownMs <= 0) return true;
    
    const cellX = Math.round((Number(x) || 0) / 60);
    const cellY = Math.round((Number(y) || 0) / 60);
    const bucketKey = `${key}:${cellX}:${cellY}`;
    const nowMs = performance.now();
    const lastMs = this.projectileImpact3DThrottle.get(bucketKey) || 0;
    if ((nowMs - lastMs) < cooldownMs) return false;
    
    this.projectileImpact3DThrottle.set(bucketKey, nowMs);
    if (this.projectileImpact3DThrottle.size > 2048) {
      const threshold = nowMs - 400;
      for (const [k, t] of this.projectileImpact3DThrottle) { if (t < threshold) this.projectileImpact3DThrottle.delete(k); }
    }
    return true;
  },

  spawnProjectileImpact3D(presetKey, color, scale = 1, x = 0, y = 0) {
    const key = String(presetKey || 'default').toLowerCase();
    if (key === 'beam' || key === 'laser') return;
    if (!this.isWorldPointNearViewport(x, y, 260)) return;
    if (!this.shouldSpawnProjectileImpact3D(key, x, y)) return;
    
    const pressure = this.getProjectileImpactVfxPressure().pressure;
    const quality = Math.max(0.16, Math.min(1, 1 - Math.max(0, pressure - 0.35) * 1.15));
    const h = window.ship?.h || 250;

    // Torpedo: massive armata-style explosion
    if (key === 'torpedo' && window.triggerArmataImpact3D) {
      window.triggerArmataImpact3D(x, y, h * 0.5 * Math.max(1.0, scale));
      // Double explosion for visual weight
      if (window.triggerRailgunExplosion3D) window.triggerRailgunExplosion3D(x, y, h * 0.35 * scale, { sparkCount: 16, sparkColor: this.resolveImpactColorInt(color || '#ff4444', 0xff4444) });
    }
    // Siege railgun: devastating rail explosion
    else if (key === 'siege' && window.triggerRailgunExplosion3D) {
      window.triggerRailgunExplosion3D(x, y, h * 0.6 * Math.max(1.2, scale), { sparkCount: 24, sparkColor: this.resolveImpactColorInt(color || '#aaffff', 0xaaffff) });
    }
    // Superweapon (hexlance): biggest effect
    else if (key === 'superweapon') {
      if (window.triggerRailgunExplosion3D) window.triggerRailgunExplosion3D(x, y, h * 0.7 * scale, { sparkCount: 32, sparkColor: this.resolveImpactColorInt(color || '#d0eaff', 0xd0eaff) });
      if (window.triggerArmataImpact3D) window.triggerArmataImpact3D(x, y, h * 0.5 * scale);
    }
    else if (key === 'helios' && window.triggerAutocannonImpact3D) window.triggerAutocannonImpact3D(x, y, h * 0.2 * Math.max(0.72, scale), color || '#ff003c', quality);
    else if ((key === 'rail' || key === 'tempest') && window.triggerRailgunExplosion3D) window.triggerRailgunExplosion3D(x, y, h * 0.2 * Math.max(0.65, scale), { sparkCount: key === 'tempest' ? 10 : 4, sparkColor: this.resolveImpactColorInt(color, key === 'tempest' ? 0x9bf5ff : 0xb0f2ff) });
    else if (['armata', 'rocket', 'missile', 'flak', 'broadside'].includes(key) && window.triggerArmataImpact3D) window.triggerArmataImpact3D(x, y, h * 0.28 * Math.max(0.75, scale));
    else if (window.triggerAutocannonImpact3D) window.triggerAutocannonImpact3D(x, y, h * 0.18 * Math.max(0.7, scale), color, quality);
  },

  // === HYBRID VFX DISPATCH ===
  // weaponSize: 'S' | 'M' → canvas 2D only (cheap, many per frame)
  // weaponSize: 'L' | 'Capital' → Three.js 3D + canvas sparks (expensive, cinematic)
  spawnWeaponImpact(presetKey, color, scale = 1, x = 0, y = 0, weaponSize = 'M') {
    const isHeavy = (weaponSize === 'L' || weaponSize === 'Capital');
    if (isHeavy) {
      // L/Capital: Three.js 3D impact (the hero effect) + GPU sparks for fill
      this.spawnProjectileImpact3D(presetKey, color, scale * (weaponSize === 'Capital' ? 1.5 : 1.0), x, y);
      const fx = this.buildBulletVfxInstance(presetKey, color);
      // GPU spark supplement for heavy weapons
      const spark3D = typeof window !== 'undefined' && window.SparkSystem3D;
      if (spark3D && spark3D.isInitialized) {
        const sparkCount = Math.round((fx.sparkCount || 12) * scale * 0.5);
        const avgSpeed = ((fx.sparkSpeed?.[0] || 200) + (fx.sparkSpeed?.[1] || 360)) * 0.5;
        const avgSize = ((fx.sparkSize?.[0] || 1.4) + (fx.sparkSize?.[1] || 2.6)) * 0.5;
        spark3D.burst(x, y, sparkCount, avgSpeed * scale, 0.35, avgSize * scale * 0.5);
      } else if (this.enabled) {
        // Fallback: canvas sparks
        const sparks = Math.round((fx.sparkCount || 12) * scale * 0.5);
        for (let i = 0; i < sparks; i++) {
          const a = Math.random() * Math.PI * 2;
          const speed = (fx.sparkSpeed?.[0] || 200) + Math.random() * ((fx.sparkSpeed?.[1] || 360) - (fx.sparkSpeed?.[0] || 200));
          const size = (fx.sparkSize?.[0] || 1.4) + Math.random() * ((fx.sparkSize?.[1] || 2.6) - (fx.sparkSize?.[0] || 1.4));
          this.spawnParticle({ x, y }, { x: Math.cos(a) * speed, y: Math.sin(a) * speed }, 0.24 + Math.random() * 0.2, this.resolveAlphaColor(fx.color, 0.85, fx.color), size * scale, true);
        }
      }
      if (this.enabled) {
        // Heavier shockwave for Capital — canvas
        const shockScale = weaponSize === 'Capital' ? 1.8 : 1.2;
        this.spawnShockwave(x, y, { r: (fx.shock?.r || 10) * scale * shockScale, maxR: (fx.shock?.maxR || 100) * scale * shockScale, w: (fx.shock?.w || 2.6) * scale * shockScale, maxLife: (fx.shock?.life || 0.32) * 1.3, color: fx.shockColorPrefix });
      }
    } else {
      // S/M: Canvas 2D only — no Three.js overhead, fast and lightweight
      this._spawnCanvasOnlyImpact(presetKey, color, scale, x, y, weaponSize);
    }
  },

  // Legacy compat — existing callers without weaponSize
  spawnWeaponImpactFromPreset(presetKey, color, scale = 1, x = 0, y = 0) {
    this.spawnWeaponImpact(presetKey, color, scale, x, y, 'M');
  },

  // Canvas-only impact for S/M weapons — GPU sparks + canvas shockwave/flash
  _spawnCanvasOnlyImpact(presetKey, color, scale = 1, x = 0, y = 0, weaponSize = 'M') {
    if (!this.isWorldPointNearViewport(x, y, 200)) return;
    const fx = this.buildBulletVfxInstance(presetKey, color);
    const sizeMul = weaponSize === 'S' ? 0.5 : 1.0;

    // GPU GLSL sparks — replace canvas particles
    const spark3D = typeof window !== 'undefined' && window.SparkSystem3D;
    if (spark3D && spark3D.isInitialized) {
      const sparkCount = Math.round((fx.sparkCount || 12) * scale * sizeMul);
      const avgSpeed = ((fx.sparkSpeed?.[0] || 200) + (fx.sparkSpeed?.[1] || 360)) * 0.5;
      const avgSize = ((fx.sparkSize?.[0] || 1.4) + (fx.sparkSize?.[1] || 2.6)) * 0.5;
      spark3D.burst(x, y, sparkCount, avgSpeed * scale, 0.3, avgSize * scale * sizeMul * 0.5);
    } else if (this.enabled) {
      // Fallback: canvas sparks if GPU system not ready
      const sparks = Math.round((fx.sparkCount || 12) * scale * sizeMul);
      for (let i = 0; i < sparks; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = (fx.sparkSpeed?.[0] || 200) + Math.random() * ((fx.sparkSpeed?.[1] || 360) - (fx.sparkSpeed?.[0] || 200));
        const size = (fx.sparkSize?.[0] || 1.4) + Math.random() * ((fx.sparkSize?.[1] || 2.6) - (fx.sparkSize?.[0] || 1.4));
        this.spawnParticle({ x, y }, { x: Math.cos(a) * speed, y: Math.sin(a) * speed }, 0.2 + Math.random() * 0.18, this.resolveAlphaColor(fx.color, 0.9, fx.color), size * scale * sizeMul, true);
      }
    }

    if (!this.enabled) return;
    // Canvas smoke stays as-is
    if (fx.smoke && fx.smokeColor) {
      const smokeCount = Math.round(fx.smoke * scale * sizeMul);
      for (let i = 0; i < smokeCount; i++) {
        const a = Math.random() * Math.PI * 2;
        const speed = 60 + Math.random() * 100;
        this.spawnParticle({ x, y }, { x: Math.cos(a) * speed, y: Math.sin(a) * speed }, 0.32 + Math.random() * 0.24, fx.smokeColor, 3 * scale * sizeMul, false);
      }
    }
    // Core flash — canvas
    this.spawnParticle({ x, y }, { x: 0, y: 0 }, 0.12, this.resolveAlphaColor(fx.color, 1, '#ffffff'), (6 + (fx.widthInner || 4)) * 0.7 * scale * sizeMul, true);
    // Shockwave — canvas
    const shockScale = weaponSize === 'S' ? 0.6 : 1.0;
    this.spawnShockwave(x, y, { r: (fx.shock?.r || 10) * scale * shockScale, maxR: (fx.shock?.maxR || 100) * scale * shockScale, w: (fx.shock?.w || 2.6) * scale * shockScale, maxLife: (fx.shock?.life || 0.32) * (weaponSize === 'S' ? 0.7 : 1.0), color: fx.shockColorPrefix });
  },

  spawnRailMuzzle(pos, dir, baseVel, scale = 1) {
    if (!this.enabled) return;
    this.spawnParticle({ x: pos.x, y: pos.y }, baseVel, 0.08, '#ffffff', 22 * scale, true);
    const angle = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < 3; i++) {
      this.spawnParticle({ x: pos.x + dir.x * i * 12 * scale, y: pos.y + dir.y * i * 12 * scale }, { x: dir.x * 60 + baseVel.x, y: dir.y * 60 + baseVel.y }, 0.06, '#bfe7ff', (14 - i * 4) * scale, true);
    }
    for (let i = 0; i < 12; i++) {
      const aa = angle + (Math.random() - 0.5) * 0.25;
      const speed = (500 + Math.random() * 300) * scale;
      this.spawnParticle({ x: pos.x, y: pos.y }, { x: Math.cos(aa) * speed + baseVel.x * 0.2, y: Math.sin(aa) * speed + baseVel.y * 0.2 }, 0.15 + Math.random() * 0.1, '#ffffff', (1.5 + Math.random() * 2.0) * scale, false);
    }
  },

  spawnArmataMuzzle(pos, dir, baseVel, scale = 1) {
    if (!this.enabled) return;
    const angle = Math.atan2(dir.y, dir.x);
    this.spawnParticle({ x: pos.x, y: pos.y }, { x: dir.x * 160 + baseVel.x * 0.12, y: dir.y * 160 + baseVel.y * 0.12 }, 0.16, '#ffd6a0', 9 * scale, true);
    for (let i = 0; i < 10; i++) {
      const aa = angle + (Math.random() - 0.5) * 0.38;
      const speed = 260 + Math.random() * 140;
      this.spawnParticle({ x: pos.x + Math.cos(aa) * 8 * scale, y: pos.y + Math.sin(aa) * 8 * scale }, { x: Math.cos(aa) * speed + baseVel.x * 0.18, y: Math.sin(aa) * speed + baseVel.y * 0.18 }, 0.16 + Math.random() * 0.14, (Math.random() < 0.5) ? '#ffbe7a' : '#ffcfa0', (2.6 + Math.random() * 2.8) * scale, true);
    }
    for (let i = 0; i < 4; i++) {
      const aa = angle + (Math.random() - 0.5) * 0.25;
      const speed = 120 + Math.random() * 60;
      this.spawnParticle({ x: pos.x + Math.cos(aa) * 4 * scale, y: pos.y + Math.sin(aa) * 4 * scale }, { x: Math.cos(aa) * speed + baseVel.x * 0.08, y: Math.sin(aa) * speed + baseVel.y * 0.08 }, 0.3 + Math.random() * 0.18, '#d76926', 1.8 * scale, false);
    }
    this.spawnShockwave(pos.x, pos.y, { r: 10 * scale, maxR: 80 * scale, w: 2.6 * scale, maxLife: 0.3, color: 'rgba(255,170,90,' });
  },

  spawnAutocannonMuzzle(pos, dir, baseVel, scale = 1) {
    if (!this.enabled) return;
    const angle = Math.atan2(dir.y, dir.x);
    this.spawnParticle({ x: pos.x, y: pos.y }, { x: dir.x * 220 + baseVel.x * 0.18, y: dir.y * 220 + baseVel.y * 0.18 }, 0.12, '#ffdba6', 7 * scale, true);
    for (let i = 0; i < 8; i++) {
      const aa = angle + (Math.random() - 0.5) * 0.32;
      const speed = 300 + Math.random() * 180;
      this.spawnParticle({ x: pos.x + Math.cos(aa) * 6 * scale, y: pos.y + Math.sin(aa) * 6 * scale }, { x: Math.cos(aa) * speed + baseVel.x * 0.16, y: Math.sin(aa) * speed + baseVel.y * 0.16 }, 0.16 + Math.random() * 0.12, (Math.random() < 0.35) ? '#ffe6b0' : '#ffbf6b', (1.6 + Math.random() * 1.6) * scale, true);
    }
    for (let i = 0; i < 4; i++) {
      const aa = angle + (Math.random() - 0.5) * 0.2;
      const speed = 120 + Math.random() * 60;
      this.spawnParticle({ x: pos.x + Math.cos(aa) * 4 * scale, y: pos.y + Math.sin(aa) * 4 * scale }, { x: Math.cos(aa) * speed + baseVel.x * 0.08, y: Math.sin(aa) * speed + baseVel.y * 0.08 }, 0.24 + Math.random() * 0.18, '#6b7cff', 1.4 * scale, false);
    }
    this.spawnShockwave(pos.x, pos.y, { r: 8 * scale, maxR: 70 * scale, w: 2.2 * scale, maxLife: 0.22, color: 'rgba(255,200,120,' });
  },

  spawnExplosionPlasma(x, y, scale = 1) {
    this.spawnProjectileImpact3D('plasma', '#7cff9c', scale, x, y);
    if (!this.enabled) return;
    this.spawnParticle({ x, y }, { x: 0, y: 0 }, 0.1, '#AAFFAA', 4 * scale, true);
    this.spawnShockwave(x, y, { r: 2, maxR: 14 * scale, w: 2, maxLife: 0.15, color: 'rgba(124, 255, 124,' });
  },
  
  spawnDefaultHit(x, y, scale = 1) {
    this.spawnProjectileImpact3D('default', '#ffd86b', scale, x, y);
    if (!this.enabled) return;
    this.spawnParticle({ x, y }, { x: 0, y: 0 }, 0.15, '#fff5d6', 7 * scale, true);
    this.spawnShockwave(x, y, { r: 4 * scale, maxR: 45 * scale, w: 3 * scale, maxLife: 0.25, color: 'rgba(255, 220, 180,' });
  },

  update(dt) {
    for (const p of this.particlePool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) { p.active = false; continue; }
      if (p.beam) continue;
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

  drawBeams(ctx, cam) {
    for (const p of this.particlePool) {
      if (!p.active || !p.beam) continue;
      const s1 = window.worldToScreen(p.start.x, p.start.y, cam);
      const s2 = window.worldToScreen(p.end.x, p.end.y, cam);
      const alphaFactor = Math.max(0, Math.min(1, 1 - p.age / Math.max(p.life, 0.0001)));
      const fade = (p.fadeWithLife === false) ? p.alpha : p.alpha * alphaFactor;
      if (fade <= 0) continue;

      ctx.save();
      ctx.globalAlpha = fade * 0.5;
      ctx.lineCap = 'round';
      ctx.strokeStyle = p.glowColor || 'rgba(120,180,255,0.9)';
      ctx.lineWidth = p.width * cam.zoom * p.outerWidthMul * 2.5;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      
      ctx.globalAlpha = fade;
      ctx.strokeStyle = p.colorOuter || 'rgba(160,210,255,0.7)';
      ctx.lineWidth = p.width * cam.zoom * p.outerWidthMul;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      
      ctx.lineCap = 'butt';
      ctx.strokeStyle = p.colorInner || 'rgba(220,240,255,1.0)';
      ctx.lineWidth = p.width * cam.zoom * p.innerWidthMul;
      ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke();
      ctx.restore();
    }
  },

  drawParticles(ctx, cam) {
    ctx.save();
    let drawn = 0;
    for (const p of this.particlePool) {
      if (!p.active || p.flash || p.beam) continue;
      if (drawn >= this.MAX_PARTICLES_DRAW) break;
      drawn++;
      const s = window.worldToScreen(p.pos.x, p.pos.y, cam);
      if (s.x < -10 || s.x > window.W + 10 || s.y < -10 || s.y > window.H + 10) continue;
      const size = p.size * cam.zoom;
      if (size < 0.8) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, 1 - p.age / p.life));
      ctx.fillStyle = p.color;
      ctx.fillRect(s.x - size * 0.5, s.y - size * 0.5, size, size);
    }
    ctx.restore();
  },

  drawFlashes(ctx, cam) {
    ctx.save();
    let drawn = 0;
    for (const p of this.particlePool) {
      if (!p.active || !p.flash) continue;
      if (drawn >= this.MAX_PARTICLES_DRAW) break;
      drawn++;
      const s = window.worldToScreen(p.pos.x, p.pos.y, cam);
      if (s.x < -50 || s.x > window.W + 50 || s.y < -50 || s.y > window.H + 50) continue;
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
    for (const p of this.lightningParticles) {
      const t = 1 - (p.age / p.maxLife);
      const s = window.worldToScreen(p.x, p.y, cam);
      if (s.x < -50 || s.x > window.W + 50 || s.y < -50 || s.y > window.H + 50) continue;
      ctx.strokeStyle = `rgba(180, 240, 255, ${t * 0.8})`;
      ctx.lineWidth = (1 + Math.random()) * cam.zoom;
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
        const noise = (Math.random() - 0.5) * p.size * 0.4 * t * cam.zoom;
        if (i < segments) ctx.lineTo(tx - Math.sin(p.angle) * noise, ty + Math.cos(p.angle) * noise);
        else ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    ctx.restore();
  },

  drawShockwaves(ctx, cam) {
    for (const s of this.shockwaves) {
      const sw = window.worldToScreen(s.x, s.y, cam);
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
    const s = window.worldToScreen(rx, ry, cam);
    const prevS = window.worldToScreen(b.px ?? rx, b.py ?? ry, cam);
    const angle = Math.atan2(b.vy, b.vx);
    const lenPx = (vfx.len || 50) * cam.zoom;

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
      const coreGrad = ctx.createLinearGradient(-lenPx / 2, 0, lenPx / 2, 0);
      coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.6)'); coreGrad.addColorStop(1, 'rgba(255, 255, 255, 1.0)');
      ctx.fillStyle = coreGrad;
      const width = (vfx.widthInner || 3) * cam.zoom;
      ctx.beginPath(); ctx.roundRect(-lenPx / 2, -width / 2, lenPx, width, width / 2); ctx.fill();
      const headSize = width * 6;
      const headGrad = ctx.createRadialGradient(lenPx / 2, 0, 0, lenPx / 2, 0, headSize);
      headGrad.addColorStop(0, 'rgba(255, 255, 255, 1)'); headGrad.addColorStop(0.3, 'rgba(200, 230, 255, 0.5)'); headGrad.addColorStop(1, 'rgba(100, 100, 255, 0)');
      ctx.fillStyle = headGrad; ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath(); ctx.arc(lenPx / 2, 0, headSize, 0, Math.PI * 2); ctx.fill();
      if (Math.random() < 0.3) this.spawnLightningSpark({ x: rx + (Math.random()-0.5)*10, y: ry + (Math.random()-0.5)*10 }, 0.3, 18, Math.random() * Math.PI * 2);
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