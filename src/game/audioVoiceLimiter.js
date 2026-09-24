// Limit głosów dźwięków strzałów — logika bez AudioContext (testowalna w node).
//
// Każdy strzał railguna w bitwie tworzył BufferSource + Gain, bez limitu i bez
// względu na odległość: 300–700 źródeł dźwięku na sekundę. Tu decydujemy, czy
// strzał w ogóle zagra i z jaką głośnością:
// - najwyżej `maxVoicesPerKey` równoczesnych głosów jednego dźwięku,
// - co najmniej `minIntervalMs` między startami głosów tego samego dźwięku,
// - tłumienie odległością od środka kamery: pełna głośność do `fullVolumeDist`,
//   liniowo do zera na `silentDist`,
// - poniżej `minVolume` nie gramy wcale.
// Liczby do strojenia w grze.

export const SHOT_AUDIO_LIMITS = Object.freeze({
  maxVoicesPerKey: 12,
  minIntervalMs: 40,
  fullVolumeDist: 2000,
  silentDist: 12000,
  minVolume: 0.01
});

export function shotDistanceGain(dist, fullVolumeDist = SHOT_AUDIO_LIMITS.fullVolumeDist, silentDist = SHOT_AUDIO_LIMITS.silentDist) {
  const d = Number(dist);
  if (!(d > fullVolumeDist)) return 1; // także NaN/brak pozycji: gramy pełnym głosem
  if (d >= silentDist) return 0;
  return 1 - (d - fullVolumeDist) / (silentDist - fullVolumeDist);
}

export function createVoiceLimiter(limits = SHOT_AUDIO_LIMITS) {
  const maxVoices = Math.max(1, limits.maxVoicesPerKey | 0);
  const minInterval = Math.max(0, Number(limits.minIntervalMs) || 0);
  const full = Number(limits.fullVolumeDist) || 0;
  const silent = Math.max(full + 1, Number(limits.silentDist) || 0);
  const minVolume = Math.max(0, Number(limits.minVolume) || 0);
  // key -> { ends: number[] (czasy końca aktywnych głosów, ms), lastStart }
  const voices = new Map();

  function slot(key) {
    let s = voices.get(key);
    if (!s) {
      s = { ends: [], lastStart: -Infinity };
      voices.set(key, s);
    }
    return s;
  }

  // Wyrzuca zakończone głosy (kompaktowanie w miejscu, bez alokacji).
  function prune(s, nowMs) {
    const ends = s.ends;
    let w = 0;
    for (let r = 0; r < ends.length; r++) {
      if (ends[r] > nowMs) ends[w++] = ends[r];
    }
    ends.length = w;
    return w;
  }

  return {
    limits: { maxVoicesPerKey: maxVoices, minIntervalMs: minInterval, fullVolumeDist: full, silentDist: silent, minVolume },

    /**
     * Czy zagrać dźwięk `key` i jak głośno. 0 = pomiń. Przy zgodzie głos jest
     * od razu liczony jako aktywny do `nowMs + durationMs`.
     */
    admit(key, nowMs, baseVolume, dist, durationMs) {
      const volume = (Number(baseVolume) || 0) * shotDistanceGain(dist, full, silent);
      if (!(volume >= minVolume) || volume <= 0) return 0;
      const s = slot(key);
      if (nowMs - s.lastStart < minInterval) return 0;
      if (prune(s, nowMs) >= maxVoices) return 0;
      s.lastStart = nowMs;
      s.ends.push(nowMs + Math.max(0, Number(durationMs) || 0));
      return volume;
    },

    activeVoices(key, nowMs) {
      const s = voices.get(key);
      return s ? prune(s, nowMs) : 0;
    },

    reset() {
      voices.clear();
    }
  };
}
