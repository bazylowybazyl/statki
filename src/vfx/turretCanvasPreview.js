// src/vfx/turretCanvasPreview.js
//
// PODGLĄD wieżyczek na kanwie 2D — sylwetki (Path2D) i atlasy sprite'ów broni z rekordów Turret2D tej klatki.
// Gra tego modułu NIE ładuje: od 2026-10-15 (B3D, docs/PLAN-render-worker.md § 7.1) wieże w grze rysuje tylko
// partia wież 3D (src/3d/ships3d/turretBatch3D.js). Zostaje dla podglądu atlasów (dema/bronie/yamato-preview.html)
// i testów atlasów sprite'ów (lufy atlasów w punktach wylotu Turret2D). Bez maskowania, cienia i zasłaniania — te
// zachowania mają wieże 3D (głębia, maska słońca, cloakLook).

import { Turret2D, TURRET_SPECS as SPECS } from './turret2D.js';
import { YamatoSprite2D } from './yamatoSprite2D.js';
import { TempestSprite2D } from './tempestSprite2D.js';
import { CiwsSprite2D } from './ciwsSprite2D.js';
import { LauncherSprite2D } from './launcherSprite2D.js';
import { SpecialWeaponSprite2D } from './specialWeaponSprite2D.js';
import { MainWeaponSprite2D } from './mainWeaponSprite2D.js';
import { PdWeaponSprite2D } from './pdWeaponSprite2D.js';

// LOD ekranowy (promień sylwetki w px): < HIDE — nic, < BLOB — jeden prostokąt w barwie pancerza, wyżej — pełna sylwetka.
const TURRET_HIDE_PX = 2.0;
const TURRET_BLOB_PX = 5.5;
const ARMOR = '#93a6c4';

// ── Kompilacja sylwetek do Path2D (raz na sylwetkę) ─────────────────────────

function addPart(path, part) {
  switch (part[0]) {
    case 'r': {
      const [, x, y, w, h, rad] = part;
      const r = Math.min(Number(rad) || 0, w * 0.5, h * 0.5);
      if (r > 0.01 && typeof path.roundRect === 'function') path.roundRect(x - w / 2, y - h / 2, w, h, r);
      else path.rect(x - w / 2, y - h / 2, w, h);
      break;
    }
    case 'c':
      path.moveTo(part[1] + part[3], part[2]);
      path.arc(part[1], part[2], part[3], 0, Math.PI * 2);
      break;
    case 'p': {
      const pts = part[1];
      if (!pts || pts.length < 3) break;
      path.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
      path.closePath();
      break;
    }
    case 'ring': {
      const [, x, y, rOut, rIn] = part;
      // Przeciwne kierunki → reguła nonzero wycina środek.
      path.moveTo(x + rOut, y);
      path.arc(x, y, rOut, 0, Math.PI * 2, false);
      path.moveTo(x + rIn, y);
      path.arc(x, y, rIn, Math.PI * 2, 0, true);
      break;
    }
    default:
      break;
  }
}

const _compiled = new WeakMap();
function compileSpec(spec) {
  let c = _compiled.get(spec);
  if (c) return c;
  const layers = [];
  for (const group of spec.g) {
    if (!group?.p?.length) continue;
    const path = new Path2D();
    for (const part of group.p) addPart(path, part);
    layers.push({ color: group.c, path, barrel: group.b === 1 });
  }
  // Blob LOD: jeden prostokąt obejmujący sylwetkę, rysowany zamiast wszystkiego.
  const blob = new Path2D();
  const len = spec.r;
  addPart(blob, ['r', len * 0.42, 0, len * 0.95, Math.max(6, len * 0.42), 2]);
  c = { layers, blob };
  _compiled.set(spec, c);
  return c;
}

/**
 * Rysuje wszystkie wieżyczki zebrane w tej klatce przez Turret2D.sync. Kamera: zoom; położenie ekranu z
 * window.worldToScreen (jak dawny pass kanwy gry). Zwraca liczbę narysowanych wieżyczek.
 */
export function drawTurretsCanvas(ctx, cam) {
  const count = Turret2D.frameCount;
  if (!Turret2D.enabled || count === 0 || !ctx) return 0;
  const worldToScreen = (typeof window !== 'undefined') ? window.worldToScreen : null;
  if (!worldToScreen) return 0;

  const zoom = Math.max(0.0001, Number(cam?.zoom) || 1);
  const origin = worldToScreen(0, 0, cam);
  const ox = origin.x;
  const oy = origin.y;
  const vw = ctx.canvas?.width || 0;
  const vh = ctx.canvas?.height || 0;

  let drawn = 0;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const rec = Turret2D.recordAt(i);
    const spec = rec.spec;
    const worldScale = rec.scale;
    const screenR = spec.r * worldScale * zoom;
    if (screenR < TURRET_HIDE_PX) continue;
    const { layers, blob } = compileSpec(spec);

    const sx = ox + rec.wx * zoom;
    const sy = oy + rec.wy * zoom;
    if (vw > 0 && (sx < -screenR * 2 || sy < -screenR * 2 || sx > vw + screenR * 2 || sy > vh + screenR * 2)) continue;

    const st = rec.state;
    const k = worldScale * zoom;
    const cosA = Math.cos(rec.ang);
    const sinA = Math.sin(rec.ang);
    const a = cosA * k, b = sinA * k, c = -sinA * k, d = cosA * k;

    if (screenR < TURRET_BLOB_PX) {
      ctx.setTransform(a, b, c, d, sx, sy);
      ctx.fillStyle = ARMOR;
      ctx.fill(blob);
      drawn++;
      continue;
    }

    const barrelBack = st ? st.barrel : 0;
    const housingBack = st ? st.housing : 0;

    if ((spec === SPECS.vulcan || spec === SPECS.helios || spec === SPECS.heavyAutocannon
      || spec === SPECS.armata || spec === SPECS.beamEmitter || spec === SPECS.beamPulse)
      && MainWeaponSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
      drawn++;
      continue;
    }
    if ((spec === SPECS.goliath || spec === SPECS.plasmaGatling || spec === SPECS.tempest2 || spec === SPECS.siegeRail)
      && SpecialWeaponSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
      drawn++;
      continue;
    }
    if ((spec === SPECS.missileRack || spec === SPECS.siegeTorpedo || spec === SPECS.fbDefault)
      && LauncherSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
      drawn++;
      continue;
    }
    if ((spec === SPECS.flak || spec === SPECS.laserPD)
      && PdWeaponSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
      drawn++;
      continue;
    }
    if (spec === SPECS.ciws && CiwsSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
      drawn++;
      continue;
    }
    if ((spec === SPECS.yamato || spec === SPECS.yamatoTwin)
      && YamatoSprite2D.draw(ctx, a, b, c, d, sx, sy, housingBack, barrelBack, spec === SPECS.yamatoTwin)) {
      drawn++;
      continue;
    }
    if ((spec === SPECS.tempest1 || spec === SPECS.tempest2 || spec === SPECS.lance)
      && TempestSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
      drawn++;
      continue;
    }

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      // Odrzut: cała wieżyczka cofa się o `housing`, lufy dodatkowo o `barrel`.
      const back = housingBack + (layer.barrel ? barrelBack : 0);
      ctx.setTransform(a, b, c, d, sx - back * a, sy - back * b);
      ctx.fillStyle = layer.color;
      ctx.fill(layer.path);
    }
    drawn++;
  }
  // restore() cofa też macierz — kanwa wraca dokładnie w stan sprzed passa.
  ctx.restore();
  return drawn;
}
