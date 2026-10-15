// ============================================================
// Dobór presetu grafiki przy PIERWSZYM uruchomieniu (2026-10-15): brak 'sc_gfx' i dawnych kluczy opcji
// (graphicsQuality.hasSavedGfx) → preset z adaptera WebGPU (adapter.info: vendor / architecture / description,
// fallback, limity) i rozdzielczości ekranu. Reguły OGÓLNE — rodzaj karty po producencie i rodzinie architektury
// (zintegrowana / dyskretna, stara / nowa generacja), bez list modeli; czego reguły nie rozpoznają — Wysoka
// (bezpieczny wynik domyślny = gra sprzed opcji). Ultra nigdy z automatu.
//
// Moduł czysty (bez DOM, three i window): describeGpuAdapter (adapter → opis), classifyGpu (opis → klasa karty),
// pickGfxPresetAuto (klasa + ekran + pamięć → preset i powody). Klej: pierwszy moduł index.html (Core3D.onAdapter —
// MSAA presetu trafia do celu sceny przed utworzeniem urządzenia), zapis i informacja w opcjach — blok
// „OPCJE GRAFIKI”. Adapter.info w Chrome nie mówi wprost „zintegrowana” — Intel bez rodziny „HP/HPG” (Arc) i
// Apple to karty zintegrowane; AMD z APU (Radeon 680M / 780M — RDNA) nie da się odróżnić od dyskretnej, więc
// RDNA = dyskretna (wynik Wysoka — ten sam co bez doboru).
// ============================================================

import { GFX_PRESET_IDS } from './graphicsQuality.js';

// Progi (megapiksele ekranu w px CSS — gra rysuje 3D w px CSS kanwy × skala renderu, nie w px urządzenia).
export const GFX_AUTO_TUNE = Object.freeze({
  // Do tylu MP (1920×1080 = 2,07; 2560×1080 = 2,76) karta zintegrowana dostaje Średnią, wyżej Niską; dyskretna
  // starszej generacji — Wysoką, wyżej (do mpLarge) Średnią.
  mpSmall: 2.4,
  // Powyżej (3440×1440 = 4,95 to jeszcze nie; 3840×2160 = 8,3 — tak) dyskretna dostaje Średnią (85%), starsza Niską.
  mpLarge: 5.2,
  // navigator.deviceMemory (GB, Chrome podaje najwyżej 8): mniej = słaby komputer, stopień niżej.
  lowMemoryGB: 4,
  // Limit tekstury 2D poniżej tego = stary sprzęt / tryb zgodności — najwyżej Średnia.
  minTexture2D: 16384
});

// Generacje uznane za STARSZE (rodziny architektury z adapter.info Chrome / Dawn): NVIDIA do Pascala (GTX 10xx),
// AMD GCN (z Vega). Nowsze i nieznane nazwy — nowa generacja.
const NVIDIA_OLD = /^(tesla|fermi|kepler|maxwell|pascal|volta)\b/;
const AMD_OLD = /^(gcn|terascale)/;
// Intel: rodziny „…hp…” / „…hpg…” (Xe-HPG, Xe2-HPG — Arc) to karty dyskretne; „gen-*” (do Gen12LP — UHD / Iris Xe)
// starsze zintegrowane; reszta (Xe-LPG, Xe2-LPG, …) — nowsze zintegrowane.
const INTEL_DISCRETE = /hpg|hpc|(^|[^a-z])hp($|[^a-z])|12hp|\barc\b/;
const INTEL_OLD = /^gen-?\d/;
// Producenci kart mobilnych (telefony, tablety, płytki ARM) — Niska. Qualcomm (Snapdragon X — laptopy) to zintegrowana.
const MOBILE_VENDORS = /^(arm|imagination|img|broadcom|samsung|mediatek|vivante|huawei)/;
// Rasteryzery programowe.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|basic render|software|(^|[^a-z])warp($|[^a-z])/;

const lc = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Opis adaptera z obiektu GPUAdapter (albo atrapy): pola info (Chrome: adapter.info — vendor, architecture, device,
 * description; isFallbackAdapter), limit tekstury 2D. Brak danych — puste napisy (wynik: Wysoka).
 */
export function describeGpuAdapter(adapter) {
  const info = (adapter && typeof adapter === 'object' && adapter.info && typeof adapter.info === 'object') ? adapter.info : {};
  const fallback = info.isFallbackAdapter ?? adapter?.isFallbackAdapter;
  const maxTex = Number(adapter?.limits?.maxTextureDimension2D);
  return {
    vendor: lc(info.vendor),
    architecture: lc(info.architecture),
    device: lc(info.device),
    description: lc(info.description),
    fallback: fallback === true,
    maxTexture2D: Number.isFinite(maxTex) && maxTex > 0 ? maxTex : 0
  };
}

// Producent po nazwie (vendor bywa pusty, gdy przeglądarka ukrywa — wtedy z opisu).
function vendorOf(d) {
  const v = d.vendor;
  const desc = d.description;
  const has = (re) => re.test(v) || re.test(desc);
  if (has(/nvidia|geforce|quadro|\brtx\b|\bgtx\b/)) return 'nvidia';
  if (has(/\bamd\b|^amd|\bati\b|radeon/)) return 'amd';
  if (has(/intel/)) return 'intel';
  if (has(/^apple|apple\b/)) return 'apple';
  if (has(/qualcomm|adreno/)) return 'qualcomm';
  if (/^microsoft/.test(v)) return 'microsoft';
  if (/^google/.test(v)) return 'google';
  if (MOBILE_VENDORS.test(v) || /\bmali\b|powervr/.test(desc)) return 'mobile';
  return v || '';
}

/**
 * Klasa karty: 'software' | 'mobile' | 'integratedOld' | 'integrated' | 'discreteOld' | 'discrete' | 'unknown',
 * producent (do opisu) i krótki powód po polsku.
 */
export function classifyGpu(desc) {
  const d = desc || describeGpuAdapter(null);
  const arch = d.architecture;
  const vendor = vendorOf(d);
  if (d.fallback || SOFTWARE.test(arch) || SOFTWARE.test(d.description) || vendor === 'microsoft'
      || (vendor === 'google' && /swiftshader|^$/.test(arch))) {
    return { tier: 'software', vendor, why: 'karta programowa (bez sprzętowej akceleracji)' };
  }
  if (vendor === 'mobile') return { tier: 'mobile', vendor, why: 'karta mobilna' };
  if (vendor === 'intel') {
    if (INTEL_DISCRETE.test(arch) || /\barc\b/.test(d.description)) return { tier: 'discreteOld', vendor, why: 'karta dyskretna Intel' };
    if (INTEL_OLD.test(arch)) return { tier: 'integratedOld', vendor, why: 'starsza karta zintegrowana Intel' };
    return { tier: 'integrated', vendor, why: 'karta zintegrowana Intel' };
  }
  if (vendor === 'apple') return { tier: 'integrated', vendor, why: 'karta zintegrowana Apple' };
  if (vendor === 'qualcomm') return { tier: 'integrated', vendor, why: 'karta zintegrowana Qualcomm' };
  if (vendor === 'nvidia') {
    if (NVIDIA_OLD.test(arch)) return { tier: 'discreteOld', vendor, why: 'starsza karta NVIDIA' };
    return { tier: 'discrete', vendor, why: 'karta dyskretna NVIDIA' };
  }
  if (vendor === 'amd') {
    if (AMD_OLD.test(arch)) return { tier: 'discreteOld', vendor, why: 'starsza karta AMD' };
    return { tier: 'discrete', vendor, why: 'karta AMD' };
  }
  return { tier: 'unknown', vendor, why: 'karta nierozpoznana' };
}

const STEP = Object.freeze({ low: 0, medium: 1, high: 2, ultra: 3 });
const down = (preset) => GFX_PRESET_IDS[Math.max(0, STEP[preset] - 1)];
const cap = (preset, max) => (STEP[preset] > STEP[max] ? max : preset);

/**
 * Preset dla adaptera i ekranu. `env`: { screenW, screenH } — rozmiar ekranu w px CSS (gra zwykle na całym oknie;
 * okno mniejsze niż ekran → wynik ostrożniejszy), { viewW, viewH } — okno (bierzemy większe), deviceMemory (GB).
 * Wynik: { preset, tier, vendor, mp, reasons: [napisy], label }.
 */
export function pickGfxPresetAuto(desc, env = {}, tune = GFX_AUTO_TUNE) {
  const cls = classifyGpu(desc);
  const sw = Math.max(0, Number(env.screenW) || 0);
  const sh = Math.max(0, Number(env.screenH) || 0);
  const vw = Math.max(0, Number(env.viewW) || 0);
  const vh = Math.max(0, Number(env.viewH) || 0);
  const [w, h] = sw * sh >= vw * vh ? [sw, sh] : [vw, vh];
  const mp = (w * h) / 1e6;
  const known = mp > 0;
  const reasons = [cls.why];
  if (known) reasons.push(`ekran ${Math.round(w)}×${Math.round(h)}`);
  let preset;
  switch (cls.tier) {
    case 'software':
    case 'mobile':
    case 'integratedOld':
      preset = 'low';
      break;
    case 'integrated':
      preset = !known || mp <= tune.mpSmall ? 'medium' : 'low';
      break;
    case 'discreteOld':
      preset = !known || mp <= tune.mpSmall ? 'high' : (mp <= tune.mpLarge ? 'medium' : 'low');
      break;
    case 'discrete':
      preset = !known || mp <= tune.mpLarge ? 'high' : 'medium';
      break;
    default:
      preset = 'high';   // bezpieczny wynik domyślny — gra sprzed opcji
  }
  const mem = Number(env.deviceMemory);
  if (Number.isFinite(mem) && mem > 0 && mem < tune.lowMemoryGB && preset !== 'low') {
    preset = down(preset);
    reasons.push(`mało pamięci (${mem} GB)`);
  }
  if (desc && desc.maxTexture2D > 0 && desc.maxTexture2D < tune.minTexture2D && STEP[preset] > STEP.medium) {
    preset = cap(preset, 'medium');
    reasons.push('stary sprzęt (limit tekstur)');
  }
  preset = cap(preset, 'high');
  return { preset, tier: cls.tier, vendor: cls.vendor, mp: +mp.toFixed(2), reasons, label: reasons.join(', ') };
}

/** ?grafikaAuto=0 — bez doboru (narzędzia), ?grafikaAuto=1 — dobór także przy zapisanych ustawieniach (próby). */
export function gfxAutoFromQuery(search) {
  let q = null;
  try { q = new URLSearchParams(String(search || '')).get('grafikaAuto'); } catch { q = null; }
  if (q == null) return null;
  const k = q.toLowerCase();
  if (k === '0' || k === 'off' || k === 'nie') return 'off';
  if (k === '1' || k === 'on' || k === 'force' || k === 'tak') return 'force';
  return null;
}
