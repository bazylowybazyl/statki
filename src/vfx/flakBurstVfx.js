// src/vfx/flakBurstVfx.js
//
// Pęknięcia flaku — port sygnatury wizualnej z prototypu `flak-wybuchy (2).html`
// na tani, płaski render 2D.
//
// Prototyp liczył to trzema pulami cząstek GLSL (12k ognia, 9k dymu, 3.6k
// odłamków) w osobnej scenie THREE w połowie rozdzielczości. W grze potrafi
// pęknąć kilkanaście pocisków naraz OBOK bitwy, która już zjada budżet klatki,
// więc zostawiamy tylko to, co niesie charakter, i płacimy za to drawImage'ami:
//
//   błysk rdzenia  — biało-gorący, gaśnie w ~0.15 s
//   pierścień      — cienka fala rozbiegająca się do promienia rażenia
//   ogień          — powłoka szybkich cząstek + wolniejsze jądro, rampa
//                    biel → bursztyn → pomarańcz → zgaszona czerwień
//   dym            — kłąb, który zostaje na kilka sekund i dryfuje
//   odłamki        — smugi z dragiem, rysowane jako odcinki
//
// Rampa koloru ognia z prototypu (fireRamp w GLSL) jest zapieczona w 4 sprite'y
// gradientowe generowane raz przy starcie. Zamiast gradientu per cząstka mamy
// drawImage z gotowej tekstury — to jest cała sztuczka wydajnościowa tego pliku.

const FIRE_STAGES = 4;

// [offset, kolor] — kolejne stadia stygnięcia odłamka ognia.
const FIRE_RAMP = [
  [['0.00', 'rgba(255,255,255,1.00)'], ['0.28', 'rgba(255,232,168,0.92)'], ['0.62', 'rgba(255,150,44,0.45)'], ['1.00', 'rgba(255,110,20,0.00)']],
  [['0.00', 'rgba(255,236,176,0.96)'], ['0.32', 'rgba(255,178,64,0.74)'], ['0.68', 'rgba(232,92,18,0.32)'], ['1.00', 'rgba(190,60,10,0.00)']],
  [['0.00', 'rgba(255,158,58,0.86)'], ['0.36', 'rgba(226,88,20,0.56)'], ['0.72', 'rgba(150,42,12,0.22)'], ['1.00', 'rgba(110,28,8,0.00)']],
  [['0.00', 'rgba(178,58,20,0.58)'], ['0.40', 'rgba(112,32,12,0.30)'], ['0.76', 'rgba(58,18,8,0.12)'], ['1.00', 'rgba(30,10,6,0.00)']]
];

const SMOKE_RAMP = [['0.00', 'rgba(96,84,72,0.58)'], ['0.45', 'rgba(58,50,44,0.30)'], ['1.00', 'rgba(28,24,22,0.00)']];
const FLASH_RAMP = [['0.00', 'rgba(255,255,255,1.00)'], ['0.16', 'rgba(255,244,208,0.88)'], ['0.44', 'rgba(255,186,86,0.40)'], ['1.00', 'rgba(255,120,30,0.00)']];

const KIND_FIRE = 0;
const KIND_SMOKE = 1;
const KIND_SHRAPNEL = 2;

function makeRadialSprite(size, stops) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const half = size * 0.5;
  const grad = g.createRadialGradient(half, half, 0, half, half, half);
  for (const [offset, color] of stops) grad.addColorStop(Number(offset), color);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return canvas;
}

function rnd(a, b) { return a + Math.random() * (b - a); }

export const FlakBurstVFX = {
  enabled: true,
  MAX_PARTS: 1400,
  MAX_BURSTS: 40,

  parts: [],
  live: [],
  head: 0,
  bursts: [],
  sprites: null,
  _initialized: false,

  init() {
    if (this._initialized) return;
    this.parts.length = 0;
    this.live.length = 0;
    for (let i = 0; i < this.MAX_PARTS; i++) {
      this.parts.push({
        x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 1,
        drag: 0.9, kind: KIND_FIRE, seed: 0, spin: 0, active: false, _idx: -1
      });
    }
    this.bursts.length = 0;
    this.head = 0;
    this._initialized = true;
  },

  ensureSprites() {
    if (this.sprites) return this.sprites;
    if (typeof document === 'undefined') return null;
    const fire = [];
    for (let i = 0; i < FIRE_STAGES; i++) fire.push(makeRadialSprite(64, FIRE_RAMP[i]));
    if (!fire[0]) return null;
    this.sprites = {
      fire,
      smoke: makeRadialSprite(64, SMOKE_RAMP),
      flash: makeRadialSprite(96, FLASH_RAMP)
    };
    return this.sprites;
  },

  isNearViewport(x, y, marginPx = 320) {
    if (typeof window === 'undefined' || !window.camera || typeof window.worldToScreen !== 'function') return true;
    const s = window.worldToScreen(x, y, window.camera);
    return s.x >= -marginPx && s.x <= (window.W + marginPx) && s.y >= -marginPx && s.y <= (window.H + marginPx);
  },

  _take() {
    const p = this.parts[this.head];
    this.head = (this.head + 1) % this.MAX_PARTS;
    if (p.active) {
      // Recykling najstarszego slotu — wypinamy go z listy żywych bez splice'a.
      const last = this.live[this.live.length - 1];
      this.live[p._idx] = last;
      last._idx = p._idx;
      this.live.pop();
    }
    p.active = true;
    p._idx = this.live.length;
    this.live.push(p);
    return p;
  },

  /**
   * Pęknięcie pocisku flak.
   *
   * @param {number} x,y     środek w świecie
   * @param {object} opts
   *   radius   — promień rażenia [u]; steruje całą skalą efektu
   *   vx,vy    — prędkość pocisku (odłamki dziedziczą część pędu)
   *   quality  — 0..1 mnożnik liczby cząstek (LOD / budżet klatki)
   */
  spawn(x, y, opts = {}) {
    if (!this.enabled) return;
    if (!this._initialized) this.init();

    const radius = Math.max(20, Number(opts.radius) || 120);
    // s = skala względem "średniego" pęknięcia M (165 u). Trzyma liczbę cząstek
    // w ryzach, gdy Capital pęka z promieniem 480 u.
    const s = Math.min(3.2, radius / 165);
    if (!this.isNearViewport(x, y, 240 + radius)) return;

    const quality = Math.max(0.15, Math.min(1, Number(opts.quality ?? 1)));
    const vx = Number(opts.vx) || 0;
    const vy = Number(opts.vy) || 0;

    if (this.bursts.length >= this.MAX_BURSTS) this.bursts.shift();
    this.bursts.push({
      x, y, radius,
      age: 0,
      flashLife: 0.13 + 0.09 * Math.sqrt(s),
      ringLife: 0.34 + 0.16 * s,
      flashSize: radius * 0.46,
      power: Math.min(1.6, 0.75 + 0.35 * s)
    });

    // — ogień: cienka szybka powłoka (62%) + wolniejsze, dłużej żyjące jądro —
    const nFire = Math.round(Math.min(34, 12 * Math.sqrt(s) + 6) * quality);
    for (let i = 0; i < nFire; i++) {
      const shell = Math.random() < 0.62;
      const a = Math.random() * Math.PI * 2;
      const sp = (shell ? rnd(0.9, 2.1) : rnd(0.12, 0.72)) * radius;
      const p = this._take();
      p.kind = KIND_FIRE;
      p.x = x + Math.cos(a) * radius * 0.05;
      p.y = y + Math.sin(a) * radius * 0.05;
      p.vx = Math.cos(a) * sp + vx * 0.18;
      p.vy = Math.sin(a) * sp + vy * 0.18;
      p.age = 0;
      p.life = shell ? rnd(0.20, 0.42) : rnd(0.34, 0.72);
      p.size = (shell ? rnd(0.10, 0.20) : rnd(0.17, 0.32)) * radius;
      p.drag = shell ? 0.06 : 0.14;
      p.seed = Math.random();
    }

    // — dym: kłąb zostaje po pęknięciu, dryfuje i puchnie —
    const nSmoke = Math.round(Math.min(20, 7 * Math.sqrt(s) + 3) * quality);
    for (let i = 0; i < nSmoke; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(0.08, 0.55) * radius;
      const p = this._take();
      p.kind = KIND_SMOKE;
      p.x = x + Math.cos(a) * radius * 0.12;
      p.y = y + Math.sin(a) * radius * 0.12;
      p.vx = Math.cos(a) * sp + vx * 0.10;
      p.vy = Math.sin(a) * sp + vy * 0.10;
      p.age = 0;
      p.life = rnd(1.3, 2.8) + s * 0.5;
      p.size = rnd(0.20, 0.40) * radius;
      p.drag = 0.85;
      p.seed = Math.random();
    }

    // — odłamki: szybkie smugi, to one "koszą" myśliwce —
    const nShrap = Math.round(Math.min(30, 11 * Math.sqrt(s) + 5) * quality);
    for (let i = 0; i < nShrap; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(2.2, 5.4) * radius;
      const p = this._take();
      p.kind = KIND_SHRAPNEL;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * sp + vx * 0.30;
      p.vy = Math.sin(a) * sp + vy * 0.30;
      p.age = 0;
      p.life = rnd(0.26, 0.62);
      p.size = rnd(0.9, 2.1);
      p.drag = 2.4;
      p.seed = Math.random();
    }
  },

  update(dt) {
    if (!this._initialized) return;
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));

    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.age += step;
      if (p.age >= p.life) {
        const last = this.live[this.live.length - 1];
        this.live[i] = last;
        last._idx = i;
        this.live.pop();
        p.active = false;
        continue;
      }
      // Wykładniczy drag — cząstka wyrzucona z pęknięcia gwałtownie hamuje
      // w pierwszych klatkach, potem tylko dryfuje. Tak zachowuje się chmura
      // gazu, a nie pocisk lecący po prostej.
      const damp = Math.exp(-p.drag * step);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * step;
      p.y += p.vy * step;
    }

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += step;
      if (b.age >= Math.max(b.flashLife, b.ringLife)) this.bursts.splice(i, 1);
    }
  },

  draw(ctx, cam) {
    if (!this.enabled || !this._initialized) return;
    if (this.live.length === 0 && this.bursts.length === 0) return;
    const sprites = this.ensureSprites();
    if (!sprites) return;

    const zoom = cam?.zoom || 1;
    const w2s = window.worldToScreen;
    const vw = window.W || 0;
    const vh = window.H || 0;

    ctx.save();

    // 1. DYM — pod ogniem, zwykłe mieszanie (ma przyciemniać, nie świecić).
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      if (p.kind !== KIND_SMOKE) continue;
      const t = p.age / p.life;
      const s = w2s(p.x, p.y, cam);
      const size = (p.size * (0.55 + t * 1.5)) * zoom;
      if (size < 1.2) continue;
      if (s.x < -size || s.x > vw + size || s.y < -size || s.y > vh + size) continue;
      ctx.globalAlpha = Math.min(1, (1 - t) * (t < 0.12 ? t / 0.12 : 1)) * 0.85;
      ctx.drawImage(sprites.smoke, s.x - size, s.y - size, size * 2, size * 2);
    }

    // 2. OGIEŃ / BŁYSK / PIERŚCIEŃ / ODŁAMKI — addytywnie.
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      if (p.kind !== KIND_FIRE) continue;
      const t = p.age / p.life;
      const s = w2s(p.x, p.y, cam);
      const size = (p.size * (0.5 + t * 1.35)) * zoom;
      if (size < 1) continue;
      if (s.x < -size || s.x > vw + size || s.y < -size || s.y > vh + size) continue;
      // Stadium stygnięcia zamiast gradientu liczonego per cząstka.
      const stage = Math.min(FIRE_STAGES - 1, (t * FIRE_STAGES) | 0);
      ctx.globalAlpha = Math.min(1, 1 - t * t);
      ctx.drawImage(sprites.fire[stage], s.x - size, s.y - size, size * 2, size * 2);
    }

    for (const b of this.bursts) {
      const s = w2s(b.x, b.y, cam);
      if (b.age < b.flashLife) {
        const t = b.age / b.flashLife;
        const size = b.flashSize * (0.6 + t * 1.1) * zoom;
        if (size >= 1 && s.x > -size && s.x < vw + size && s.y > -size && s.y < vh + size) {
          ctx.globalAlpha = Math.min(1, (1 - t) * b.power);
          ctx.drawImage(sprites.flash, s.x - size, s.y - size, size * 2, size * 2);
        }
      }
      if (b.age < b.ringLife) {
        const t = b.age / b.ringLife;
        // Fala zwalnia przy krawędzi rażenia — sqrt zamiast liniowego rozrostu.
        const r = b.radius * Math.sqrt(t) * zoom;
        if (r >= 1.5 && r < Math.max(vw, vh) * 2) {
          ctx.globalAlpha = (1 - t) * (1 - t) * 0.75;
          ctx.strokeStyle = 'rgba(255,206,128,1)';
          ctx.lineWidth = Math.max(1, (1 - t) * 5 * zoom);
          ctx.beginPath();
          ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,224,158,1)';
    ctx.beginPath();
    let shrapDrawn = 0;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      if (p.kind !== KIND_SHRAPNEL) continue;
      const t = p.age / p.life;
      const s = w2s(p.x, p.y, cam);
      if (s.x < -40 || s.x > vw + 40 || s.y < -40 || s.y > vh + 40) continue;
      // Smuga = ślad z ostatnich ~28 ms lotu.
      const tailX = p.vx * 0.028 * zoom;
      const tailY = p.vy * 0.028 * zoom;
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - tailX, s.y - tailY);
      shrapDrawn++;
    }
    if (shrapDrawn > 0) {
      // Jeden stroke na wszystkie odłamki — alfa wspólna, bo i tak gasną razem.
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(0.8, 1.6 * zoom);
      ctx.stroke();
    }

    ctx.restore();
  },

  clear() {
    for (let i = 0; i < this.live.length; i++) this.live[i].active = false;
    this.live.length = 0;
    this.bursts.length = 0;
  },

  getStats() {
    return { particles: this.live.length, bursts: this.bursts.length };
  }
};
