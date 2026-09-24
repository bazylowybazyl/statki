// Filtr przeszkód dla pętli pocisków (bulletsAndCollisionsStep).
//
// Stacje i platformy misji były sprawdzane dla KAŻDEGO pocisku w KAŻDYM kroku
// fizyki (tysiące pocisków × kilkadziesiąt stacji × 120 Hz), choć pociski bitwy
// zwykle nie leżą nawet w pobliżu żadnej. Raz na krok liczymy pudło (AABB)
// pozycji wszystkich pocisków PO ruchu w tym kroku i zostawiamy tylko obiekty,
// których okrąg kolizji je przecina (zwykle 0–2). Pętla per pocisk robi dalej
// dokładnie te same testy, tylko na krótkiej liście — wynik bez zmian.

export function createBulletStepBounds() {
  return { count: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, maxR: 0 };
}

const finite = (v) => (Number.isFinite(v) ? v : 0);

// Pozycja po kroku liczona tak samo jak stepProjectileKinematics
// (x + vx·dt, prędkość z początku kroku), więc pudło jest ścisłe.
export function computeBulletStepBounds(bullets, dt, out) {
  out.count = 0;
  out.minX = Infinity;
  out.maxX = -Infinity;
  out.minY = Infinity;
  out.maxY = -Infinity;
  out.maxR = 0;
  if (!bullets) return out;
  const step = Math.max(0, finite(dt));
  for (let i = 0; i < bullets.length; i++) {
    const b = bullets[i];
    if (!b) continue;
    const x = finite(b.x) + finite(b.vx) * step;
    const y = finite(b.y) + finite(b.vy) * step;
    if (x < out.minX) out.minX = x;
    if (x > out.maxX) out.maxX = x;
    if (y < out.minY) out.minY = y;
    if (y > out.maxY) out.maxY = y;
    const r = Number(b.r);
    // Pocisk bez skończonego promienia: dawny test per pocisk porównywał z NaN
    // (i „trafiał” wszystko) — wtedy nie filtrujemy niczego w tym kroku.
    if (!Number.isFinite(r)) out.maxR = Infinity;
    else if (r > out.maxR) out.maxR = r;
    out.count++;
  }
  return out;
}

// Wpisuje do `out` obiekty z `list`, których okrąg (radiusOf(obj) + maxR pocisku)
// przecina pudło. Kolejność zachowana (pierwsze trafienie wygrywa jak dotąd).
// Zwraca liczbę wpisów; `out.length` też jest ustawiane.
export function filterCirclesTouchingBounds(list, bounds, radiusOf, out) {
  out.length = 0;
  if (!list || !bounds || bounds.count === 0) return 0;
  for (let i = 0; i < list.length; i++) {
    const obj = list[i];
    if (!obj) continue;
    const baseR = Number(radiusOf(obj));
    // Bez skończonego promienia albo pozycji (NaN) obiekt zostaje: dokładny test
    // per pocisk porównuje wtedy z NaN i zachowuje się jak dawniej.
    if (!Number.isFinite(baseR)) {
      out.push(obj);
      continue;
    }
    const r = baseR + bounds.maxR;
    const x = obj.x;
    const y = obj.y;
    if (x + r < bounds.minX || x - r > bounds.maxX || y + r < bounds.minY || y - r > bounds.maxY) continue;
    out.push(obj);
  }
  return out.length;
}

export function stationCollisionRadius(st) {
  return st.hitR || st.r;
}

export function platformCollisionRadius(p) {
  return p.radius;
}
