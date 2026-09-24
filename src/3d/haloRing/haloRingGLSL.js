// Wspólne chunki GLSL ringu „Halo”. Wszystko liczy się w LOKALNYM układzie
// ringu (oś = Z, środek planety na (0, 0, −W/2)). Materiały składają chunki
// w kolejności: COMMON → NOISE → LIGHT → AIR (→ SURFACE).
//
// Kierunek habitatu to uniform uHabitat.x = σ: +1 habitat w stronę kosmosu
// („góra” = od planety), −1 klasyczne Halo („góra” = ku osi). Wszystkie
// funkcje poniżej są od niego zależne, żaden shader nie zakłada strony.
//
// Model światła (brief §6): w tej skali mapy cieni nie działają, więc
// widoczność słońca liczy się analitycznie — sfera planety (półcień
// z czerwonym brzegiem jak przy zaćmieniu Księżyca) + bryła ringu
// (dwie ściany jako pierścienie w płaszczyznach, podłoga jako walec/stożek,
// kadłub jako walec). Do tego światło planety i niebo habitatu.

export const HALO_GLSL_COMMON = /* glsl */`
#define HALO_PI 3.14159265359
#define HALO_TAU 6.28318530718
uniform float uTime;
uniform vec4 uRing;        // rim, floorMid, hull, dr/dz podlogi
uniform vec4 uRingZ;       // roof, topIn, botIn, bottom
uniform vec4 uFloorLine;   // r(t=0), z(t=0), tangent.r, tangent.z
uniform vec4 uFloorDims;   // L, Wf, floorMid, wallHeight
uniform vec4 uPlanet;      // srodek xyz, promien
uniform vec4 uHabitat;     // sigma (+1 na zewnatrz, -1 do planety), promien kadluba, bryla r min, r max
uniform float uPlanetAtmoH;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunAngular;
uniform vec4 uPlanetshine;
uniform float uPlanetAlbedo;
uniform float uSkyAmbient;
uniform float uNightAmbient;
uniform vec3 uAirRayleigh;
uniform vec3 uAirMie;      // beta, g, mnoznik wielokrotnego rozpraszania
uniform float uAirScaleH;
uniform float uSkyBoost;
uniform float uAirOn;
uniform vec3 uCamLocal;
uniform vec3 uRefRel;
uniform vec4 uRefBasis;    // cos thref, sin thref, thref, sref
uniform vec4 uLayers;      // chmury, swiatla miast, statki, drzewa
uniform vec4 uCloudParams; // wysokosc, grubosc, wiatr, pokrycie
uniform float uNightLights;

float haloFloorRadiusAtZ(float z) {
  return uRing.y + (z - 0.5 * (uRingZ.y + uRingZ.z)) * uRing.w;
}
// wysokosc nad bazowa podloga w kierunku sigma * r
float haloAltitude(vec3 p) { return uHabitat.x * (length(p.xy) - haloFloorRadiusAtZ(p.z)); }
vec3 haloUp(vec3 p) {
  float l = max(length(p.xy), 1.0);
  return vec3(uHabitat.x * p.xy / l, 0.0);
}
float haloLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 haloSrgbToLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
`;

export const HALO_GLSL_NOISE = /* glsl */`
// Hasz calkowity (lowbias32, C. Wellons) - bit w bit ten sam co haloHashU
// w haloRingRoofPlan.js, wiec reguly komorek dachu licza sie identycznie
// na GPU i na CPU. Wejscie: dokladne calkowite nieujemne zapisane we float.
uint haloLowbias(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}
float haloHashI(float a, float b, float salt) {
  uint h = haloLowbias(uint(a) ^ haloLowbias(uint(b) ^ haloLowbias(uint(salt))));
  return float(h >> 8u) / 16777216.0;
}
float haloHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float haloHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 haloHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 haloHash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
// szum gradientowy 3D, wynik ~[-1, 1]
float haloGnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = dot(haloHash33(i) * 2.0 - 1.0, f);
  float n100 = dot(haloHash33(i + vec3(1.0, 0.0, 0.0)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(haloHash33(i + vec3(0.0, 1.0, 0.0)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(haloHash33(i + vec3(1.0, 1.0, 0.0)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(haloHash33(i + vec3(0.0, 0.0, 1.0)) * 2.0 - 1.0, f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(haloHash33(i + vec3(1.0, 0.0, 1.0)) * 2.0 - 1.0, f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(haloHash33(i + vec3(0.0, 1.0, 1.0)) * 2.0 - 1.0, f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(haloHash33(i + vec3(1.0, 1.0, 1.0)) * 2.0 - 1.0, f - vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, w.x);
  float nx10 = mix(n010, n110, w.x);
  float nx01 = mix(n001, n101, w.x);
  float nx11 = mix(n011, n111, w.x);
  return 1.6 * mix(mix(nx00, nx10, w.y), mix(nx01, nx11, w.y), w.z);
}
// okresowy szum gradientowy 2D (tekstury kafelkowe)
float haloGnoise2P(vec2 p, vec2 period, float salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 i00 = mod(i, period);
  vec2 i10 = mod(i + vec2(1.0, 0.0), period);
  vec2 i01 = mod(i + vec2(0.0, 1.0), period);
  vec2 i11 = mod(i + vec2(1.0, 1.0), period);
  vec2 g00 = normalize(haloHash22(i00 + salt) * 2.0 - 1.0 + 1e-4);
  vec2 g10 = normalize(haloHash22(i10 + salt) * 2.0 - 1.0 + 1e-4);
  vec2 g01 = normalize(haloHash22(i01 + salt) * 2.0 - 1.0 + 1e-4);
  vec2 g11 = normalize(haloHash22(i11 + salt) * 2.0 - 1.0 + 1e-4);
  float a = dot(g00, f);
  float b = dot(g10, f - vec2(1.0, 0.0));
  float c = dot(g01, f - vec2(0.0, 1.0));
  float d = dot(g11, f - vec2(1.0, 1.0));
  return 1.41 * mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
// okresowy Worley: x = F1, y = hash komorki, z = F2
vec3 haloWorleyP(vec2 p, vec2 period, float salt) {
  vec2 i = floor(p);
  vec2 f = p - i;
  float best = 8.0;
  float second = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = mod(i + o, period);
      vec2 h = haloHash22(c + salt + 17.0);
      vec2 d = o + h - f;
      float dd = dot(d, d);
      if (dd < best) {
        second = best;
        best = dd;
        id = haloHash12(c + salt + 3.1);
      } else if (dd < second) {
        second = dd;
      }
    }
  }
  return vec3(sqrt(best), id, sqrt(second));
}
`;

export const HALO_GLSL_LIGHT = /* glsl */`
// Transmisja promienia p + t*L przez okolice planety: geometryczny polcien
// tarczy slonca + zaczerwienienie w atmosferze przy krawedzi + slaba czerwien
// w cieniu wlasciwym (swiatlo zalamane w atmosferze, jak przy zacmieniu).
vec3 haloPlanetTransmit(vec3 p, vec3 L) {
  vec3 oc = uPlanet.xyz - p;
  float tc = dot(oc, L);
  if (tc <= 0.0) return vec3(1.0);
  float R = uPlanet.w;
  float d = sqrt(max(dot(oc, oc) - tc * tc, 0.0));
  float w = max(tc * uSunAngular, 2.0);
  float geo = smoothstep(R - w, R + w, d);
  float hA = max(d - R, 0.0);
  float tau = 2.6 * exp(-hA / max(uPlanetAtmoH * 0.32, 1.0));
  vec3 trans = exp(-tau * vec3(0.16, 0.52, 1.3));
  vec3 umbra = vec3(0.05, 0.013, 0.004) * smoothstep(R * 0.6, R, d);
  return max(trans * geo, umbra);
}

// Zasloniecie przez bryle ringu: plaszczyzny scian (dach, wnetrza scian,
// spod) jako pierscienie [r min, r max] bryly, podloga jako stozek r = a + b*z
// (b = 0 -> walec) i walec kadluba w pasie [bottom, roof]. Polcien rosnie
// z dystansem.
float haloWallPlane(vec3 p, vec3 L, float zPlane, float pen) {
  float t = (zPlane - p.z) / L.z;
  if (t <= 1.0) return 1.0;
  float r = length(p.xy + t * L.xy);
  float soft = max(t * pen, 1.0);
  float inside = smoothstep(uHabitat.z - soft, uHabitat.z + soft, r) * (1.0 - smoothstep(uHabitat.w - soft, uHabitat.w + soft, r));
  return 1.0 - inside;
}
float haloConeHit(vec3 p, vec3 L, float ti, float pen) {
  if (ti <= 1.0) return 1.0;
  float z = p.z + ti * L.z;
  float soft = max(ti * pen, 1.0);
  float inBand = smoothstep(uRingZ.w - soft, uRingZ.w + soft, z) * (1.0 - smoothstep(uRingZ.x - soft, uRingZ.x + soft, z));
  return 1.0 - inBand;
}
float haloRingBlock(vec3 p, vec3 L) {
  float pen = uSunAngular * 2.0;
  float vis = 1.0;
  if (abs(L.z) > 1e-4) {
    vis = min(vis, haloWallPlane(p, L, uRingZ.x, pen));
    vis = min(vis, haloWallPlane(p, L, uRingZ.y, pen));
    vis = min(vis, haloWallPlane(p, L, uRingZ.z, pen));
    vis = min(vis, haloWallPlane(p, L, uRingZ.w, pen));
  }
  float b = uRing.w;
  float a = uRing.y - 0.5 * (uRingZ.y + uRingZ.z) * b;
  float rp = a + b * p.z;
  float A = dot(L.xy, L.xy) - b * b * L.z * L.z;
  float B = 2.0 * (dot(p.xy, L.xy) - b * L.z * rp);
  float C = dot(p.xy, p.xy) - rp * rp;
  float disc = B * B - 4.0 * A * C;
  if (disc > 0.0 && abs(A) > 1e-6) {
    float sq = sqrt(disc);
    vis = min(vis, haloConeHit(p, L, (-B - sq) / (2.0 * A), pen));
    vis = min(vis, haloConeHit(p, L, (-B + sq) / (2.0 * A), pen));
  }
  // kadlub (walec r = uHabitat.y, pelny na calej szerokosci pasa) - dla
  // punktow po jego drugiej stronie, np. na planecie albo w przestrzeni
  float Ch = dot(p.xy, p.xy) - uHabitat.y * uHabitat.y;
  float Bh = dot(p.xy, L.xy);
  float Ah = dot(L.xy, L.xy);
  float dh = Bh * Bh - Ah * Ch;
  if (dh > 0.0 && Ah > 1e-6) {
    float sq = sqrt(dh);
    vis = min(vis, haloConeHit(p, L, (-Bh - sq) / Ah, pen));
    vis = min(vis, haloConeHit(p, L, (-Bh + sq) / Ah, pen));
  }
  return vis;
}
vec3 haloSunVisibility(vec3 p, vec3 L) {
  return haloPlanetTransmit(p, L) * haloRingBlock(p, L);
}

// Swiatlo planety: tarcza o polkacie A = asin(R/d), jasnosc z fazy
// (sfera Lamberta), nocna strona doklada swiatla miast Ziemi. Habitat
// w strone kosmosu ma planete pod podloga - dla punktow nad podloga zero.
vec3 haloPlanetshine(vec3 p, vec3 n) {
  if (uHabitat.x > 0.0 && haloAltitude(p) > -5.0 && p.z > uRingZ.w - 50.0 && p.z < uRingZ.x + 50.0) return vec3(0.0);
  vec3 toP = uPlanet.xyz - p;
  float dist = max(length(toP), uPlanet.w + 1.0);
  vec3 dirP = toP / dist;
  float sinA = clamp(uPlanet.w / dist, 0.0, 0.9999);
  float g = acos(clamp(dot(-dirP, uSunDir), -1.0, 1.0));
  float phase = (sin(g) + (HALO_PI - g) * cos(g)) / HALO_PI;
  float cb = dot(n, dirP);
  float view = pow(clamp((cb + sinA) / (1.0 + sinA), 0.0, 1.0), 1.4);
  float E = sinA * sinA * view;
  vec3 lit = uPlanetshine.rgb * uPlanetAlbedo * uPlanetshine.a * max(phase, 0.0) * uSunColor;
  vec3 night = vec3(0.9, 0.55, 0.25) * 0.004 * (1.0 - clamp(phase, 0.0, 1.0));
  return (lit + night) * E;
}

// Niebo habitatu: rozproszone swiatlo nieba nad punktem. Niebo to caly slup
// powietrza nad wstega, nie tylko punkt tuz nad powierzchnia - w cieniu
// sciany nadal swieci oswietlona reszta nieba (probki: wysoko nad punktem
// i nad osia pasa).
vec3 haloSkyAmbient(vec3 p, vec3 n) {
  vec3 up = haloUp(p);
  vec3 above = p + up * 1150.0;
  vec3 mid = vec3(above.xy, 0.5 * (uRingZ.y + uRingZ.z));
  vec3 sunAir = 0.5 * (haloSunVisibility(above, uSunDir) + haloSunVisibility(mid, uSunDir));
  float sunUp = clamp(dot(uSunDir, up) * 0.75 + 0.35, 0.0, 1.0);
  float hemi = 0.55 + 0.45 * dot(n, up);
  return vec3(0.34, 0.55, 1.0) * uSkyAmbient * sunAir * uSunColor * sunUp * hemi;
}
`;

export const HALO_GLSL_AIR = /* glsl */`
#ifndef AIR_STEPS
#define AIR_STEPS 8
#endif
// Wejscie promienia (kamera -> fragment) do warstwy powietrza, w ktorej lezy
// fragment. Jedyny otwarty brzeg powietrza to walec r = rim miedzy scianami.
// Korzenie t1 < t2: promien jest wewnatrz walca dla t w (t1, t2).
// Halo (sigma < 0): powietrze na zewnatrz walca -> wejscie w t2.
// Na zewnatrz (sigma > 0): powietrze wewnatrz walca -> wejscie w t1.
float haloAirEntry(vec3 o, vec3 d, float tHit) {
  float A = dot(d.xy, d.xy);
  if (A < 1e-8) return 0.0;
  float B = dot(o.xy, d.xy);
  float C = dot(o.xy, o.xy) - uRing.x * uRing.x;
  float disc = B * B - A * C;
  if (disc <= 0.0) return 0.0;
  float sq = sqrt(disc);
  float tE = uHabitat.x > 0.0 ? (-B - sq) / A : (-B + sq) / A;
  return (tE > 0.0 && tE < tHit) ? tE : 0.0;
}
// Wyjscie z powietrza przez otwarty brzeg (kamera wewnatrz powietrza).
float haloAirExit(vec3 o, vec3 d) {
  float A = dot(d.xy, d.xy);
  if (A < 1e-8) return -1.0;
  float B = dot(o.xy, d.xy);
  float C = dot(o.xy, o.xy) - uRing.x * uRing.x;
  float disc = B * B - A * C;
  if (disc <= 0.0) return -1.0;
  return uHabitat.x > 0.0 ? (-B + sqrt(disc)) / A : (-B - sqrt(disc)) / A;
}
float haloAirDensity(vec3 x) {
  float alt = haloAltitude(x);
  float inBand = step(uRingZ.z, x.z) * step(x.z, uRingZ.y);
  float top = uFloorDims.w;
  return exp(-max(alt, 0.0) / uAirScaleH) * inBand * (1.0 - smoothstep(top * 0.8, top * 1.02, alt));
}
// Calka rozpraszania pojedynczego (Rayleigh + Mie) wzdluz [t0, t1] z widocznoscia
// slonca w kazdej probce (cienie scian i planety w powietrzu -> smugi).
void haloAirIntegrate(vec3 o, vec3 d, float t0, float t1, float jitter, out vec3 inscat, out vec3 trans) {
  inscat = vec3(0.0);
  trans = vec3(1.0);
  if (uAirOn < 0.5 || t1 <= t0) return;
  float mu = dot(d, uSunDir);
  float phaseR = 0.1875 * (1.0 + mu * mu);
  float g = uAirMie.y;
  float g2 = g * g;
  float phaseM = 0.25 * (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5);
  vec3 bR = uAirRayleigh;
  float bM = uAirMie.x;
  vec3 ext = bR + vec3(bM * 1.1);
  float dt = (t1 - t0) / float(AIR_STEPS);
  for (int i = 0; i < AIR_STEPS; i++) {
    float t = t0 + (float(i) + jitter) * dt;
    vec3 x = o + d * t;
    float rho = haloAirDensity(x);
    if (rho < 1e-4) continue;
    vec3 up = haloUp(x);
    float cz = dot(uSunDir, up);
    float colSun = rho * uAirScaleH / max(cz + 0.12, 0.06);
    vec3 sunT = haloSunVisibility(x, uSunDir) * exp(-ext * colSun);
    vec3 ps = haloPlanetshine(x, up);
    vec3 S = (bR * phaseR + vec3(bM * phaseM)) * sunT * uSunColor * uAirMie.z + bR * ps * 0.6;
    vec3 stepOD = ext * rho * dt;
    vec3 stepT = exp(-stepOD);
    inscat += trans * S * rho * dt * ((vec3(1.0) - stepT) / max(stepOD, vec3(1e-6)));
    trans *= stepT;
  }
}
// Niebo habitatu (powloka): cienka warstwa dostaje wzmocnienie, ktore znika,
// gdy droga optyczna sie nasyca (horyzont zgadza sie z mgla na terenie).
float haloSkyGain(vec3 trans) {
  float tauG = -log(max(trans.g, 1e-4));
  return mix(uSkyBoost, 1.0, smoothstep(0.05, 1.2, tauG));
}
// Perspektywa powietrzna dla powierzchni wewnatrz powietrza habitatu.
vec3 haloApplyAir(vec3 color, vec3 rel, float jitter) {
  float tHit = length(rel);
  vec3 d = rel / max(tHit, 1e-3);
  float t0 = haloAirEntry(uCamLocal, d, tHit);
  vec3 ins;
  vec3 tr;
  haloAirIntegrate(uCamLocal, d, t0, tHit, jitter, ins, tr);
  return color * tr + ins;
}
float haloIGN(vec2 fc) {
  return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
}
`;

// Pozycja względem kamery (RTE) dla punktu na podłodze/nad podłogą.
// Kąt liczony od kąta odniesienia θref (blisko kamery), więc błędy float
// są proporcjonalne do odległości od kamery, a nie do promienia ringu.
// Shader NIE używa modelMatrix do translacji: host liczy uCamLocal i uRefRel
// w układzie lokalnym ringu (odwrotność matrixWorld grupy), a obrót grupy
// wchodzi przez mat3(modelMatrix) w haloProjectRel().
// Miejsca na podlodze: kompleksy portowe (hala K-7 + 2 zatoki) i portale
// tranzytow powtarzaja sie co okres wzdluz ringu — shader zna tylko szablon
// jednego okresu (4 prostokaty w tablicy na 5), nie liczy wszystkich 16 miejsc
// na piksel.
// Plyta bez zabudowy, strefy wokol niej (pas fabryczny -> domy) i
// przejasnienie w chmurach. Prostokat = (przesuniecie od srodka kompleksu,
// pol-rozpietosc s, t0, t1); strefa = (zasieg przemyslu, zasieg domow).
export const HALO_GLSL_PORTSITES = /* glsl */`
uniform vec4 uPortTile;       // s srodka kompleksu 0 [j. na floorMid], okres [j.], liczba (0 = brak), -
uniform vec4 uPortRects[5];
uniform vec4 uPortZones[5];
float haloPortDS(vec4 R, float sAbs) {
  float d = sAbs - uPortTile.x - R.x;
  return d - uPortTile.y * floor(d / uPortTile.y + 0.5);
}
float haloPortPad(float sAbs, float t, float L, float grow, float soft) {
  float m = 0.0;
  if (uPortTile.z > 0.5) {
    for (int i = 0; i < 5; i++) {
      vec4 P = uPortRects[i];
      if (P.y > 0.5) {
        float ds = haloPortDS(P, sAbs);
        float a = 1.0 - smoothstep(P.y + grow, P.y + grow + soft, abs(ds));
        float b = (1.0 - smoothstep(0.0, soft, P.z - grow - t)) * (1.0 - smoothstep(0.0, soft, t - P.w - grow));
        m = max(m, a * b);
      }
    }
  }
  return m;
}
// Wagi stref wokol plyt dokow: x = pas fabryczny, y = osady (do zoneRes);
// odleglosc od prostokata plyty, w poprzek wstegi liczona x 1/0,6 (pas
// wezszy ku scianom, zeby przy brzegach wstegi mogly zostac gory sektora),
// krawedz zafalowana przez warp. Tranzyty bez stref. z = 0.
// w = oslona: nad plyta (od jej gornej krawedzi do gornej sciany, w pasie
// plyty wzdluz ringu) teren zostaje niski — w kamerze gry wszystko nad
// plaszczyzna gry lezy blizej kamery i zaslonilby dok (doki i tranzyty).
vec4 haloPortZones(float sAbs, float t, float L, float warp) {
  vec4 w = vec4(0.0);
  if (uPortTile.z > 0.5) {
    for (int i = 0; i < 5; i++) {
      vec4 P = uPortRects[i];
      vec4 Z = uPortZones[i];
      if (P.y < 0.5) Z = vec4(0.0);          // pusty prostokat szablonu
      float ds = haloPortDS(P, sAbs);
      float dx = max(abs(ds) - P.y, 0.0);
      float dy = max(max(P.z - t, t - P.w), 0.0) / 0.6;
      float d = max(length(vec2(dx, dy)) + warp, 0.0);
      float ind = Z.x > 1.0 ? 1.0 - smoothstep(Z.x * 0.72, Z.x * 1.2, d) : 0.0;
      float res = Z.y > 1.0 ? 1.0 - smoothstep(Z.y * 0.8, Z.y * 1.2, d) : 0.0;
      float shield = Z.w > 0.5 ? (1.0 - smoothstep(P.y + 150.0, P.y + 750.0, abs(ds))) * smoothstep(P.w - 450.0, P.w, t) : 0.0;
      w = max(w, vec4(ind, res, 0.0, shield));
    }
  }
  return w;
}
`;

// Tranzyty przez ring: wyciecie w terenie (podloga) i kadlubie wokol z = 0,
// w osiach co 2 pi / liczba (haloTransitAngles w haloRingConfig.js).
export const HALO_GLSL_TRANSIT = /* glsl */`
uniform vec4 uTransit;     // kat pierwszej osi, krok [rad], liczba, pol-szerokosc wyciecia [j. na floorMid]
uniform vec4 uTransitZ;    // z od, z do (wyciecie)
bool haloInTransitCut(float sAbs, float z) {
  if (uTransit.z < 0.5 || z < uTransitZ.x || z > uTransitZ.y) return false;
  float th = sAbs / uFloorDims.z;
  float k = floor((th - uTransit.x) / uTransit.y + 0.5);
  float d = (th - uTransit.x - k * uTransit.y) * uFloorDims.z;
  return abs(d) < uTransit.w;
}
`;

// Gorna polowa wstegi nad plaszczyzna gry (rysowana w FG): w kamerze gry
// znika, gdy kamera schodzi nisko nad nia (uFgFade.x liczy CPU z powiekszenia
// h/(h - z)), i ma wyciecia nad graczem pod dachem — liczone w rzucie
// fragmentu na z = 0 z kamery gry, wiec wyciecie odslania dokladnie to, co
// lezy pod nim w plaszczyznie gry. Bez HALO_FG funkcje sa puste.
export const HALO_GLSL_FG = /* glsl */`
#ifdef HALO_FG
uniform vec4 uFgFade;          // x widocznosc calosci, y = 1 kamera gry, z krawedz dachu nad wawozem, w promien gornej krawedzi podlogi
uniform vec4 uCutA[2];         // srodek x, y (uklad ringu), os cos, sin
uniform vec4 uCutB[2];         // pol a (wzdluz osi), pol b, miekkosc, sila
float haloFgVisibility(vec3 p) {
  // „sciany w dol”: dach nad wawozem habitatu (d = sigma * (r - podloga) > 0)
  // chowa sie od krawedzi scian ku podlodze — widoczny tylko dla d < krawedz
  float d = uHabitat.x * (length(p.xy) - uFgFade.w);
  float vis = uFgFade.x * (1.0 - smoothstep(uFgFade.z - 30.0, uFgFade.z + 30.0, d));
  if (uFgFade.y > 0.5) {
    // jeden punkt wyjscia (kompilator D3D ostrzega przy wczesnym return)
    float dz = uCamLocal.z - p.z;
    vec2 P = uCamLocal.xy + (p.xy - uCamLocal.xy) * (uCamLocal.z / max(dz, 1.0));
    for (int i = 0; i < 2; i++) {
      vec4 A = uCutA[i];
      vec4 B = uCutB[i];
      if (B.w > 0.001) {
        vec2 dd = P - A.xy;
        vec2 l = abs(vec2(dot(dd, A.zw), dot(dd, vec2(-A.w, A.z))));
        float rc = min(B.x, B.y);
        vec2 q = l - (B.xy - rc);
        float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rc;
        vis *= mix(1.0, smoothstep(0.0, B.z, sd), B.w);
      }
    }
    vis *= step(1.0, dz);
  }
  return vis;
}
#else
float haloFgVisibility(vec3 p) { return 1.0; }
#endif
`;
// Tylko we fragmencie: przerzedzenie (dither) zamiast przezroczystosci —
// bryly dachu nie wymagaja sortowania.
export const HALO_GLSL_FG_CLIP = /* glsl */`
void haloFgClip(vec3 p) {
#ifdef HALO_FG
  float v = haloFgVisibility(p);
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (v < 0.999 && v <= n) discard;
#endif
}
`;

export const HALO_GLSL_RTE = /* glsl */`
// dr = r - floorMid (male liczby), dTheta = kat od katu odniesienia
vec3 haloRelFromPolar(float dTheta, float dr, float z) {
  float sh = sin(0.5 * dTheta);
  float r = uFloorDims.z + dr;
  float localR = dr - 2.0 * r * sh * sh;
  float localT = r * sin(dTheta);
  vec2 er = uRefBasis.xy;
  vec2 et = vec2(-er.y, er.x);
  return vec3(er * localR + et * localT, z) + uRefRel;
}
vec4 haloProjectRel(vec3 relLocal) {
  vec3 view = mat3(viewMatrix) * (mat3(modelMatrix) * relLocal);
  return projectionMatrix * vec4(view, 1.0);
}
`;
