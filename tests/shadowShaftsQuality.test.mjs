import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coreSource = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
const planetSource = readFileSync(new URL('../src/3d/planet3d.assets.js', import.meta.url), 'utf8');
const shipsSource = readFileSync(new URL('../src/3d/hexShips3D.js', import.meta.url), 'utf8');
const hullSdfSource = readFileSync(new URL('../src/3d/hullShadowSdf.js', import.meta.url), 'utf8');
const ringSource = readFileSync(new URL('../src/3d/haloRing/haloRingGame.js', import.meta.url), 'utf8');
const asteroidSource = readFileSync(new URL('../src/3d/asteroidField3D.js', import.meta.url), 'utf8');
const gameSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('shadow shafts are fully analytic — screen-space mask is gone', () => {
  // Maska okluzji odeszla w calosci: nie obejmowala okluderow poza kadrem
  // (cien planety znikal przy przyblizeniu), gubila male kadluby po
  // downresie+blurze i kosztowala 4 przejscia sceny na viewport.
  for (const relic of ['uOcclusionMap', 'occlusionTarget', 'occlusionWhiteMaterial', 'OCCLUSION_RENDER_LAYER', 'OCCLUSION_ORTHO_RENDER_LAYER', 'OCCLUSION_SPRITE', 'NUM_SAMPLES', 'createSeparableBlurMaterial']) {
    assert.ok(!coreSource.includes(relic), `mask relic still present in core3d.js: ${relic}`);
  }
  // Trzy rodziny analitycznych okluderow w shaderze passa: dyski, kadluby
  // (pole odleglosci sylwetki) i pierscienie.
  for (const uniformName of ['uDiscs', 'uHullA', 'uHullM', 'uHullC', 'uHullSdf', 'uHullSteps', 'uRings', 'uSunWorld', 'uCamCenter', 'uViewWorldSize', 'uSunActive']) {
    assert.ok(coreSource.includes(uniformName), `shafts shader missing uniform ${uniformName}`);
  }
  assert.match(coreSource, /const SHAFT_DISC_CAP = 48;/);
  assert.match(coreSource, /const SHAFT_HULL_CAP = HULL_SDF_SHAFT_CAP;/);
  assert.match(hullSdfSource, /export const HULL_SDF_SHAFT_CAP = 32;/);
  assert.match(coreSource, /const SHAFT_RING_CAP = 2;/);
  // Blok GLSL kadlubow wstrzykiwany przed main passa.
  assert.match(coreSource, /\$\{HULL_SDF_SHADOW_GLSL\}/);
});

test('quality levels map to shaft lengths and capsule budget', () => {
  const cfgBlock = coreSource.match(/export const SHADOW_SHAFTS_QUALITY = \{([\s\S]*?)\n\};/)?.[1] || '';
  assert.ok(cfgBlock, 'SHADOW_SHAFTS_QUALITY config missing');
  for (const level of ['off:', 'low:', 'medium:', 'high:']) {
    assert.ok(cfgBlock.includes(level), `missing quality level ${level}`);
  }
  assert.match(cfgBlock, /high:\s*\{\s*enabled:\s*true,\s*discLenMul:\s*7,\s*capsuleLenMul:\s*4,\s*capsuleBudget:\s*32,\s*hullSteps:\s*32/);
  // Kroki marszu po SDF kadluba — tylko uniform, bez rekompilacji.
  for (const level of ['off', 'low', 'medium', 'high']) {
    assert.match(cfgBlock, new RegExp(`${level}:[^\\n]*hullSteps:\\s*\\d+`), `missing hullSteps for ${level}`);
  }
  assert.match(coreSource, /uShafts\.uHullSteps\.value = Math\.max\(1, Math\.min\(HULL_SDF_MAX_STEPS, Number\(shaftCfg\.hullSteps\) \|\| 24\)\);/);
  assert.match(coreSource, /setShadowShaftsQuality\(level = 'medium'\)/);
  assert.match(coreSource, /shadowShaftsQuality: this\.shadowShaftsQuality \|\| 'medium'/);
});

test('shafts write a sun-visibility mask before the scene instead of multiplying it', () => {
  // Dawniej quad mnozyl GOTOWY obraz po warstwie 0: bron i dysze (warstwa 0)
  // spadaly w umbrze pod prog bloomu, a ring dostawal drugi cien.
  const scenePassList = coreSource.match(/_scenePasses\s*=\s*\[([\s\S]*?)\]/)?.[1] || '';
  assert.ok(scenePassList.length > 0, 'scene pass chain missing');
  assert.ok(!scenePassList.includes('this.shadowShaftsPass'), 'shafts pass must not blend into the scene buffer');
  assert.ok(!coreSource.includes('BLEND_MULTIPLY_SCENE'), 'full-screen multiply blend is back');
  assert.match(coreSource, /new FullScreenBlendPass\(createShadowShaftsShader\(\), \{ blending: THREE\.NoBlending \}\)/);
  // Maska: RGBA8 bez MSAA, rozmiar bufora sceny (teksel 1:1 z gl_FragCoord).
  assert.match(coreSource, /this\.sunShadowTarget = new THREE\.WebGLRenderTarget\(/);
  assert.match(coreSource, /if \(this\.sunShadowTarget\) this\.sunShadowTarget\.setSize\(bufW, bufH\);/);
  // Wyjscie shadera = maska (R powierzchnia, G tlo), bez sluzby 1 = "nic".
  assert.match(coreSource, /gl_FragColor = vec4\(surfaceOut, backdropOut, 0\.0, 1\.0\);/);
  assert.ok(!coreSource.includes('mix(vec3(1.0), vec3(0.06, 0.10, 0.16), rawShadow)'), 'old image multiply output is back');
  // Kolejnosc w render(): maska PRZED pre-passem halo (atmosfery ja czytaja)
  // i przed lancuchem passow sceny.
  const renderAt = coreSource.indexOf('\n  render() {');
  const maskAt = coreSource.indexOf('this._renderSunShadowMask(', renderAt);
  const haloAt = coreSource.indexOf('renderPlanetHaloViewport(this.activeCam1', renderAt);
  const chainAt = coreSource.indexOf('for (const pass of this._scenePasses)', renderAt);
  assert.ok(renderAt >= 0 && maskAt > renderAt, 'render() must build the sun shadow mask');
  assert.ok(maskAt < haloAt && maskAt < chainAt, 'mask must be ready before halo pre-pass and scene passes');
  // Snapshot refrakcji ma polowe rozdzielczosci — skala teksela idzie za celem.
  assert.match(coreSource, /this\._setSunShadowTexelFor\(this\.refractionTarget\);/);
});

test('shields render in ortho without clearing depth and never read the mask', () => {
  const shieldSource = readFileSync(new URL('../src/3d/shield3D.js', import.meta.url), 'utf8');
  // Tarcza to emisja, nie oswietlona powierzchnia.
  assert.ok(!/sunShadow|SUN_SHADOW_GLSL/.test(shieldSource), 'shield glow must not be dimmed by the sun shadow mask');
  // Kamera ortho (jak swiat) + BEZ czyszczenia glebi (test glebi wzgledem kadlubow).
  assert.match(coreSource, /makeSplitScreenRenderPass\(this\.renderPassShields,\s*SHIELD_RENDER_LAYER,\s*true,\s*false,\s*false\)/);
  assert.match(coreSource, /new RenderPass\(this\.scene, this\.cameraOrtho\)/);
  // Obie tarcze (obrys kadluba i banka) musza trafic na warstwe tarcz.
  const shieldLayerCalls = shieldSource.match(/Core3D\.enableShield3D\(mesh\)/g) || [];
  assert.equal(shieldLayerCalls.length, 2, 'both hull and sphere shield meshes must use the shield layer');
});

test('analytic occluders skip interiors so surfaces keep their own lighting', () => {
  // Dyski: wnetrze tarczy = oswietlenie planety; kadluby: piksel NA wlasnym
  // kadlubie (SDF < progu) = jego wlasne oswietlenie w shaderze heksow;
  // ring na powierzchni planety = uRingShadow* w shaderze planety (bez
  // podwojnego liczenia w passie).
  assert.match(coreSource, /if \(along <= exitDist\) continue;/);
  // Pomijany CALY statek, nie jedna jego czesc — lancuch kapsul pomijal
  // tylko wnetrze tej samej kapsuly i kazda cienila kadlub pod sasiednia.
  assert.match(hullSdfSource, /if \(t <= 0\.0 && hullSdfDist\(q, layer, distScale\) < wMin\) continue;/);
  assert.match(coreSource, /if \(!insideDisc\) \{/);
});

test('planets and moons push analytic discs every frame', () => {
  const planetPushes = planetSource.match(/Core3D\.pushShaftDiscWorld\(/g) || [];
  assert.ok(planetPushes.length >= 2, 'both DirectPlanet and DirectMoon must push disc occluders');
  assert.match(planetSource, /beginShaftDiscFrame/);
  assert.match(coreSource, /pushShaftDiscWorld\(worldX, worldY, radius, strength = 1\)/);
});

test('ships push size-sorted hull silhouettes from the hex update loop', () => {
  assert.match(coreSource, /pushShaftHullSdf\(packed, offset = 0\)/);
  assert.match(shipsSource, /Core3D\.beginShaftHullFrame\(\);/);
  assert.match(shipsSource, /Core3D\.pushShaftHullSdf\(shaftOccluderScratch, 0\)/);
  assert.match(shipsSource, /cands\.sort\(\(a, b\) => b\.size - a\.size\)/);
  // Ring-segmenty pomijane — pierscien ma wlasny okrag-okluder.
  assert.match(shipsSource, /entity\.isRingSegment\) continue;/);
  // Budzet kadlubow wg jakosci: hexShips3D staje na nim (nie piecze
  // sylwetek, ktorych pass nie wezmie), render() tnie na wszelki wypadek.
  assert.match(coreSource, /getShaftHullBudget\(\) \{/);
  assert.match(shipsSource, /pushed < shaftHullBudget/);
  assert.match(coreSource, /shaftCfg\.capsuleBudget/);
  // Obrot i skala okludera = mesh kadluba (rotation.z = -kat, billboard +kat).
  assert.match(shipsSource, /const rot = usesBillboardOrientation\(c\.entity\) \? rawAng : -rawAng;/);
  assert.match(shipsSource, /const renderRotation = usesBillboardOrientation\(entity\) \? entityAngle : -entityAngle;/);
});

test('hull occluder is the silhouette distance field, not a capsule chain', () => {
  // Kapsuly nie opisza kolcow, widelca dziobu ani prostokatnej rufy: krotkie
  // pasma zwijaly sie do okregow wystajacych poza kadlub (Atlas: 131 j. za
  // rufa), a promien z najszerszego punktu zostawial pas swiatla przy burcie.
  for (const relic of ['buildHullSegments', 'splitProfileIntoBands', 'HULL_SHAFT_SEGMENTS', '_shaftHullSegments']) {
    assert.ok(!shipsSource.includes(relic), `capsule relic back in hexShips3D.js: ${relic}`);
  }
  assert.ok(!coreSource.includes('HULL_SHAFT_BANDS'), 'capsule band count back in core3d.js');
  assert.ok(shipsSource.includes('HullShadowSdf.acquire(c.grid, now)'), 'hexShips3D must acquire the hull SDF layer');
  // Sylwetka = aktywne heksy ∩ alfa sprite'a (dziury po trafieniach + brak
  // szczeliny od heksow brzegowych wystajacych poza rysowana krawedz).
  assert.ok(hullSdfSource.includes('return !!s && s.active !== false && s.isDebris !== true;'));
  assert.ok(hullSdfSource.includes('sampleAlphaMap(alphaMap, sx * invW, sy * invH) < HULL_SDF_ALPHA_INSIDE'));
  // Wraki ida z puli: warstwa wazna tylko dla tej samej tablicy heksow.
  assert.ok(hullSdfSource.includes('return entry.shardsRef === grid.shards &&'));
  assert.ok(hullSdfSource.includes('const sameShape = entry.layer >= 0 && sameGridAs(entry, grid);'));
  // Brzeg prostokata SDF musi byc dalej niz najszerszy polcien.
  const margin = Number(hullSdfSource.match(/HULL_SDF_MARGIN_TEXELS = (\d+);/)?.[1]);
  const soft = Number(hullSdfSource.match(/HULL_SDF_SOFT_TEXELS = (\d+);/)?.[1]);
  const range = Number(hullSdfSource.match(/HULL_SDF_RANGE_TEXELS = (\d+);/)?.[1]);
  assert.ok(soft < margin && margin <= range, 'soft < margin <= range');
});

test('hull shaft starts at the hull edge and only dims the scene', () => {
  // Marsz po SDF od piksela do slonca: promien wchodzacy w kadlub tuz za
  // burta daje pelny cien, polcien rosnie z dystansem od statku.
  assert.ok(hullSdfSource.includes('float w = max(softMax * clamp(t / span, 0.0, 1.0), wMin);'));
  assert.ok(coreSource.includes('shadow = max(shadow, hullSdfShadow(worldP, d, sunDist) * ${HULL_SHADOW_STRENGTH.toFixed(2)});'));
  // Statek/asteroida tylko przygaszaja; umbra do czerni zostaje planetom.
  assert.match(coreSource, /const HULL_SHADOW_STRENGTH = 0\.55;/);
  assert.match(coreSource, /shadow = max\(shadow, edge \* fall \* max\(disc\.w, 0\.0\)\);/);
  assert.match(asteroidSource, /const ASTEROID_SHAFT_STRENGTH = 0\.5;/);
  assert.match(asteroidSource, /pushShaftDiscWorld\(cache\[i\]\.x, cache\[i\]\.y, cache\[i\]\.r, ASTEROID_SHAFT_STRENGTH\)/);
});

test('planetary rings register analytic circle occluders', () => {
  assert.match(coreSource, /setShaftRingOccluder\(key, cx, cy, radius, reach\)/);
  assert.match(coreSource, /removeShaftRingOccluder\(key\)/);
  // Ring „Halo” (haloRingGame.js): środek obwiedni, zasięg ×1,15 jak dawny ring;
  // rejestracja co klatkę PRZED zbudowaniem ringu i testem kadru — cień działa
  // także przy ringu poza kadrem albo jeszcze niezbudowanym (Mars).
  assert.match(ringSource, /Core3D\.setShaftRingOccluder\?\.\(e\.occluderKey, e\.place\.x, e\.place\.y, ringMid, ringMid \* HALO_GAME\.occluderReachMul\);/);
  assert.match(ringSource, /occluderReachMul: 1\.15/);
  assert.match(ringSource, /Core3D\.removeShaftRingOccluder\?\.\(e\.occluderKey\);/);
  const updateFrom = ringSource.indexOf('update(dt, cam, opts = {}) {');
  const registerAt = ringSource.indexOf('Core3D.setShaftRingOccluder?.(e.occluderKey');
  const buildAt = ringSource.indexOf('this._ensureRing(e);', updateFrom);
  const gateAt = ringSource.indexOf('const inView =', updateFrom);
  assert.ok(updateFrom >= 0 && registerAt > updateFrom && buildAt > registerAt && gateAt > registerAt,
    'ring occluder must be registered before the ring is built and before the view gate');
});

test('large asteroids push analytic discs with throttled selection', () => {
  assert.match(asteroidSource, /_pushShaftOccluders\(\)/);
  assert.match(asteroidSource, /Core3D\.pushShaftDiscWorld\(cache\[i\]\.x, cache\[i\]\.y, cache\[i\]\.r, ASTEROID_SHAFT_STRENGTH\)/);
  assert.match(asteroidSource, /const MIN_RADIUS = 90;/);
  assert.match(asteroidSource, /this\._shaftFrameCounter % 4 === 1/);
  assert.ok(!asteroidSource.includes('occluderMesh'), 'asteroid sprite occluder twin should be gone');
});

test('escape menu exposes off/low/medium/high shadow shafts option', () => {
  for (const level of ['off', 'low', 'medium', 'high']) {
    assert.ok(gameSource.includes(`data-shaft-q="${level}"`), `missing menu chip for ${level}`);
  }
  assert.match(gameSource, /sc_shadow_shafts/);
  assert.match(gameSource, /window\.Core3DShaftQuality/);
  // Presety: fast -> low, ultrafast -> off, base -> zapisany poziom.
  assert.match(gameSource, /setShadowShaftsQuality\?\.\('low'\)/);
  assert.match(gameSource, /setShadowShaftsQuality\?\.\('off'\)/);
});

test('sun shadow mask module shares uniform objects and keeps the backdrop tint', async () => {
  const mask = await import('../src/3d/sunShadowMask.js');
  const uniforms = mask.attachSunShadowUniforms({ own: { value: 1 } });
  // TE SAME obiekty co w module — Core3D ustawia je raz na klatke dla wszystkich.
  assert.equal(uniforms.uSunShadowMap, mask.sunShadowUniforms.uSunShadowMap);
  assert.equal(uniforms.uSunShadowTexel, mask.sunShadowUniforms.uSunShadowTexel);
  assert.equal(uniforms.uSunShadowOn, mask.sunShadowUniforms.uSunShadowOn);
  assert.equal(uniforms.uSunShadowFill, mask.sunShadowUniforms.uSunShadowFill);
  assert.equal(uniforms.own.value, 1);
  assert.deepEqual([...mask.SUN_SHAFT_BACKDROP_TINT], [0.06, 0.10, 0.16]);
  // Otoczenie w pelnym cieniu: widoczny cien, ale nie czarna kaluza (dawniej ×0,06).
  assert.equal(mask.SUN_SHADOW_FILL, 0.4);
  assert.equal(mask.sunShadowUniforms.uSunShadowFill.value, mask.SUN_SHADOW_FILL);
  assert.match(mask.SUN_SHADOW_GLSL, /float sunFill\(float vis\) \{\s*return mix\(uSunShadowFill, 1\.0, vis\);/);
  // Odczyt po gl_FragCoord i wylaczenie uniformem (bez slonca / shafty Off).
  assert.match(mask.SUN_SHADOW_GLSL, /gl_FragCoord\.xy \* uSunShadowTexel/);
  assert.match(mask.SUN_SHADOW_GLSL, /if \(uSunShadowOn < 0\.5\) return vec2\(0\.0\);/);
  assert.match(mask.SUN_SHADOW_GLSL, /float sunVisibility\(\)/);
  assert.match(mask.SUN_SHADOW_GLSL, /vec3 sunShaftBackdrop\(vec3 color\)/);
  assert.match(mask.SUN_SHADOW_GLSL, /vec3\(0\.0600000, 0\.100000, 0\.160000\)/);
  // Wbudowane materialy: wstrzykniecie w onBeforeCompile, osobny klucz programu.
  const fakeMaterial = {};
  mask.applySunShadowToBuiltinMaterial(fakeMaterial, 'direct');
  const shader = { uniforms: {}, fragmentShader: 'void main() {\n#include <lights_fragment_end>\n#include <opaque_fragment>\n}' };
  fakeMaterial.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uSunShadowOn, mask.sunShadowUniforms.uSunShadowOn);
  assert.match(shader.fragmentShader, /reflectedLight\.directDiffuse \*= sunVisD;/);
  assert.doesNotMatch(shader.fragmentShader, /sunShaftBackdrop\(gl_FragColor/);
  assert.equal(fakeMaterial.customProgramCacheKey(), 'sunShadow:direct');
});

test('lit surfaces lose the sun term and dim fill; lights, glow and heat stay', () => {
  const hullFragment = shipsSource.match(/const HEX_FRAGMENT_SHADER = `([\s\S]*?)`;/)?.[1] || '';
  const debrisFragment = shipsSource.match(/const DEBRIS_FRAGMENT_SHADER = `([\s\S]*?)`;/)?.[1] || '';
  assert.ok(hullFragment && debrisFragment, 'hull shaders missing');
  assert.match(hullFragment, /\$\{SUN_SHADOW_GLSL\}/);
  assert.match(hullFragment, /float lightMul = uDayAmbient \* sunFill\(sunVis\) \+ dayDiffuse \* uDayDiffuseMul \* sunVis;/);
  assert.match(hullFragment, /color \+= vec3\(spec \* uSpecularMul \* litMask \* sunVis\);/);
  // Glow z koloru w pelnym sloncu — niebieskie elementy nie gasna w cieniu.
  assert.match(hullFragment, /float isGlowing = step\(0\.6, sunlitColor\.b\) \* step\(sunlitColor\.r, 0\.5\);/);
  // Odblask slonca w lakierze gasnie, odbicie nieba zostaje.
  assert.match(hullFragment, /float lobe = \(pow\(RdotL, glintExp\)[\s\S]*?\(sheenExp \/ uLacquerC\.x\)\) \* sunVis;/);
  // Swiatla statku, stres i zar NIE widza maski.
  const lightsLoop = hullFragment.slice(hullFragment.indexOf('for (int i = 0; i < MAX_SHIP_LIGHTS'));
  assert.ok(lightsLoop.length > 0 && !/sunVis/.test(lightsLoop), 'ship lights, stress and heat must ignore the mask');
  assert.match(debrisFragment, /float lightMul = uDayAmbient \* sunFill\(sunVis\) \+ NdotL \* uDayDiffuseMul \* sunVis;/);
  // Wspolne obiekty uniformow w materialach kadluba i odlamkow.
  assert.ok((shipsSource.match(/\.\.\.sunShadowUniforms/g) || []).length >= 2, 'hull and debris materials must share mask uniforms');

  const impostorSource = readFileSync(new URL('../src/3d/hexBodyImpostorBatch.js', import.meta.url), 'utf8');
  assert.match(impostorSource, /sunShadeUnlit\(vColor/);
  assert.match(impostorSource, /uniforms: \{ \.\.\.sunShadowUniforms \}/);

  const bridgeSource = readFileSync(new URL('../src/3d/bridge3D.js', import.meta.url), 'utf8');
  assert.match(bridgeSource, /float hullLight = uB3Light\.x \* sunFill\(sunVis\) \+ \(vB3Hull\.x - uB3Light\.x\) \* sunVis;/);
  assert.match(bridgeSource, /float dif = max\(0\.0, NdotL\) \* uB3Light\.y \* sh \* sunVis;/);
  assert.match(bridgeSource, /float dark = \(1\.0 - sh\) \* uB3Shadow\.y \* sunVisibility\(\) \+ \(1\.0 - ao\);/);
});

test('emitters and the Halo ring never read the sun shadow mask', () => {
  const read = (rel) => readFileSync(new URL(`../src/3d/${rel}`, import.meta.url), 'utf8');
  // Emisja swieci w cieniu jak poza nim — to one maja rozswietlac umbre.
  for (const rel of ['weapon3DSystem.js', 'mainExhaust3D.js', 'warpPlume3D.js', 'engineExhaustBatch.js',
    'fxParticles3D.js', 'railgunFx3D.js', 'slugTrail3D.js', 'muzzleFx3D.js', 'shipLights3D.js',
    'shieldImpactFx.js', 'bridgeFx3D.js']) {
    assert.ok(!/sunShadowUniforms|SUN_SHADOW_GLSL|sunVisibility/.test(read(rel)), `${rel} must not read the sun shadow mask`);
  }
  // Ring ma wlasny model slonca (zacmienie + cien scian, slonce 49°).
  const ringFiles = ['haloRingGLSL.js', 'haloRingGame.js', 'index.js', 'haloRingTerrain.js', 'haloRingCity.js', 'haloRingMegastructure.js'];
  for (const rel of ringFiles) {
    assert.ok(!/sunShadowUniforms|SUN_SHADOW_GLSL|sunVisibility/.test(read(`haloRing/${rel}`)), `haloRing/${rel} must keep its own sun model`);
  }
  // Okrag ringu tylko w kanale tla — powierzchnia (R) konczy sie na kadlubach.
  assert.match(coreSource, /float surfaceShadow = shadow;[\s\S]*if \(!insideDisc\) \{[\s\S]*float backdropOut = clamp\(shadow, 0\.0, 1\.0\) \* uShaftGain;/);
});

test('backdrop keeps the long shaft; ring-anchored bodies get eclipses', () => {
  assert.match(planetSource, /gl_FragColor = vec4\(sunShaftBackdrop\(color \* boost\), 1\.0\);/);
  assert.match(planetSource, /finalColor = sunShaftBackdrop\(finalColor\);/);
  const beltSource = readFileSync(new URL('../src/3d/asteroidBeltBackdrop3D.js', import.meta.url), 'utf8');
  assert.match(beltSource, /col = sunShaftBackdrop\(col\);/);
  assert.match(beltSource, /applySunShadowToBuiltinMaterial\(this\.dustMaterial, 'backdrop'\);/);
  // Planety tla (perspektywa, z = -50 000) nie czytaja maski liczonej w plaszczyznie gry.
  assert.match(planetSource, /uSunShadowRecv: \{ value: this\.isRingAnchored \? 1\.0 : 0\.0 \}/);
  assert.match(planetSource, /mixFactor \*= sunVisP;/);
  assert.match(planetSource, /if \(this\.isRingAnchored\) applySunShadowToBuiltinMaterial\(material, 'direct'\);/);
});
