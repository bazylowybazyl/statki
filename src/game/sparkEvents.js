// src/game/sparkEvents.js
//
// Iskry kadłubów po stronie GRY (RW-22, docs/PLAN-render-worker.md § 3.3, § 2.6 p. 26): odbiorca subskrybenta
// CollisionFX (src/vfx/collisionSparks.js — budżet iskier liczy gra, strumień gry fxRandomGame) z tymi samymi metodami
// co SparkSystem3D (`grindingBurst`, `grindingSeam`), który zamiast rysować pisze rekordy SPARK_BURST / SPARK_SEAM
// (src/render/hullCommands.js). `ready` — render ma iskry (inline: SparkSystem3D.isInitialized po init; worker — flaga
// z kanału zwrotnego).

import { HC, SPARK_BURST, SPARK_SEAM } from '../render/hullCommands.js';

export function createSparkEvents(writer) {
  return {
    ready: false,
    grindingBurst(x, y, nx, ny, tx, ty, approach, slide, bvx, bvy, count, gain = 1) {
      const S = SPARK_BURST;
      const o = writer._begin(HC.SPARK_BURST, S.WORDS);
      const d = writer.ring.data;
      d[o + S.X] = x; d[o + S.Y] = y; d[o + S.NX] = nx; d[o + S.NY] = ny; d[o + S.TX] = tx; d[o + S.TY] = ty;
      d[o + S.APPROACH] = approach; d[o + S.SLIDE] = slide; d[o + S.BVX] = bvx; d[o + S.BVY] = bvy;
      d[o + S.COUNT] = count; d[o + S.GAIN] = gain;
      writer._commit();
    },
    // Punkty szwu (bufor silnika belek, żywy tylko na czas zdarzenia) — kopia do rekordu.
    grindingSeam(points, pointCount, tx, ty, approach, slide, bvx, bvy, count, gain = 1) {
      const S = SPARK_SEAM;
      const available = points ? (points.length >> 2) : 0;
      const n = Math.max(0, Math.min(pointCount | 0, available));
      const o = writer._begin(HC.SPARK_SEAM, S.WORDS + 4 * n);
      const d = writer.ring.data;
      d[o + S.TX] = tx; d[o + S.TY] = ty; d[o + S.APPROACH] = approach; d[o + S.SLIDE] = slide;
      d[o + S.BVX] = bvx; d[o + S.BVY] = bvy; d[o + S.COUNT] = count; d[o + S.GAIN] = gain; d[o + S.N] = n;
      for (let i = 0; i < 4 * n; i++) d[o + S.POINTS + i] = points[i];
      writer._commit();
    }
  };
}
