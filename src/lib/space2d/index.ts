import REGL from "regl";
import Alea from "alea";

// --- WBUDOWANE SHADERY ---

const commonVert = `
precision highp float;
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0, 1);
}`;

const noiseChunk = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 fade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float cnoise(vec3 P) {
  vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
  Pi0 = mod289(Pi0); Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 * (1.0 / 7.0); vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5; gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0); vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 * (1.0 / 7.0); vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5; gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1); vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x); vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z); vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x); vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z); vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
  float n000 = dot(g000, Pf0); float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z)); float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z)); float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz)); float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}`;

const backgroundFrag = `
precision highp float;
varying vec2 uv;
uniform vec3 color;
uniform vec2 offset;
uniform float depth, scale, density, falloff, lacunarity, gain;
uniform int octaves;
${noiseChunk}
float fbm(vec3 p) {
  float amplitude = 1.0; float frequency = 1.0; float sum = 0.0; float q = 0.0;
  for (int i = 0; i < 16; i++) {
    sum += amplitude * cnoise(frequency * p);
    q += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
    if (i >= octaves) break;
  }
  return sum / q;
}
void main() {
  vec3 p = vec3(scale * (gl_FragCoord.xy + offset), 0.002 * depth);
  float d = density * exp(-falloff * (0.5 + 0.5 * fbm(p)));
  gl_FragColor = vec4(d * color, 1.0);
}`;

const nebulaFrag = `
precision highp float;
varying vec2 uv;
uniform sampler2D starPositionTexture, starColorTexture;
uniform vec3 emissiveHigh, emissiveLow, albedoHigh, albedoLow, albedoOffset, emissiveOffset;
uniform vec2 offset;
uniform float scale, depth, density, falloff, absorption, gain, lacunarity, albedoScale, emissiveScale;
uniform int octaves, nStars;
${noiseChunk}
float fbm(vec3 p) {
  float amplitude = 1.0; float frequency = 1.0; float sum = 0.0; float q = 0.0;
  for (int i = 0; i < 32; i++) {
    sum += amplitude * cnoise(frequency * p);
    q += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
    if (i >= octaves) break;
  }
  return sum / q;
}
void main() {
  vec3 p = vec3(scale * (gl_FragCoord.xy + offset), 0.002 * depth);
  float d = fbm(p);
  d = abs(d);
  d = exp(-falloff * d);
  d *= density;

  vec3 totalLight = vec3(0.0);
  
  // POPRAWIONE OŚWIETLENIE - łagodniejsze tłumienie
  for (int i = 0; i < 128; i++) {
    if (i >= nStars) break;
    vec2 xy = vec2((float(i) + 0.5) / float(nStars), 0.5);
    vec3 pos = texture2D(starPositionTexture, xy).rgb;
    
    vec3 dl = vec3(scale * pos.xy, 0.002 * pos.z) - p;
    // Używamy prostego kwadratowego spadku bez gigantycznego mnożnika
    float distSq = dot(dl, dl);
    
    // Zmniejszamy mnożnik z 2000.0 na 2.0 - to kluczowa zmiana!
    // Dzięki temu światło dociera dalej i oświetla chmury.
    float light = 1.0 / (1.0 + distSq * 2.0); 
    
    totalLight += light * texture2D(starColorTexture, xy).rgb;
  }

  vec3 emissive = mix(emissiveLow, emissiveHigh, abs(cnoise(p * emissiveScale + emissiveOffset)));
  vec3 albedo = mix(albedoLow, albedoHigh, abs(cnoise(p * albedoScale + albedoOffset)));
  
  // Mieszamy światło z kolorem mgławicy
  gl_FragColor = vec4(totalLight * d * albedo + d * emissive, d * absorption);
}`;

const pasteFrag = `
precision highp float;
varying vec2 uv;
uniform sampler2D texture;
void main() { gl_FragColor = texture2D(texture, uv); }`;

const accumulateFrag = `
precision highp float;
varying vec2 uv;
uniform sampler2D incidentTexture, lightTexture;
void main() {
  vec4 incident = texture2D(incidentTexture, uv);
  vec4 light = texture2D(lightTexture, uv);
  gl_FragColor = vec4(incident.rgb * exp(-light.a) + light.rgb, 1.0);
}`;

// --- KLASA Space2D ---

export class Space2D {
  private canvas: HTMLCanvasElement;
  private regl: REGL.Regl;
  private renderBackground: REGL.DrawCommand;
  private renderNebula: REGL.DrawCommand;
  private paste: REGL.DrawCommand;
  private accumulate: REGL.DrawCommand;
  private pingpong: REGL.Framebuffer2D[];
  private fbLight: REGL.Framebuffer2D;
  private starPositionTexture: REGL.Texture2D;
  private starColorTexture: REGL.Texture2D;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1;
    this.canvas.height = 1;

    // Używamy 'float' (bezpieczniejsze niż half float)
    this.regl = REGL({
      canvas: this.canvas,
      attributes: { preserveDrawingBuffer: true, alpha: false, depth: false },
      extensions: ["OES_texture_float", "WEBGL_color_buffer_float"],
      optionalExtensions: ["OES_texture_float_linear"]
    });

    const common = { vert: commonVert, attributes: { position: [-4,-4,4,-4,0,4] }, count: 3, depth: { enable: false }, viewport: this.regl.prop("viewport") };

    this.renderBackground = this.regl({ ...common, frag: backgroundFrag, uniforms: {
        depth: this.regl.prop("depth"), color: this.regl.prop("color"), scale: this.regl.prop("scale"),
        lacunarity: this.regl.prop("lacunarity"), gain: this.regl.prop("gain"), octaves: this.regl.prop("octaves"),
        density: this.regl.prop("density"), falloff: this.regl.prop("falloff"), offset: this.regl.prop("offset"),
      }, framebuffer: this.regl.prop("framebuffer") });

    this.renderNebula = this.regl({ ...common, frag: nebulaFrag, uniforms: {
        depth: this.regl.prop("depth"), starPositionTexture: this.regl.prop("starPositionTexture"), starColorTexture: this.regl.prop("starColorTexture"), nStars: this.regl.prop("nStars"),
        scale: this.regl.prop("scale"), absorption: this.regl.prop("absorption"), emissiveLow: this.regl.prop("emissiveLow"), emissiveHigh: this.regl.prop("emissiveHigh"),
        emissiveOffset: this.regl.prop("emissiveOffset"), emissiveScale: this.regl.prop("emissiveScale"), albedoLow: this.regl.prop("albedoLow"), albedoHigh: this.regl.prop("albedoHigh"),
        albedoOffset: this.regl.prop("albedoOffset"), albedoScale: this.regl.prop("albedoScale"), lacunarity: this.regl.prop("lacunarity"), gain: this.regl.prop("gain"),
        octaves: this.regl.prop("octaves"), density: this.regl.prop("density"), falloff: this.regl.prop("falloff"), offset: this.regl.prop("offset"),
      }, blend: { enable: true, func: { src: "one", dst: "one" } }, framebuffer: this.regl.prop("framebuffer") });

    this.paste = this.regl({ ...common, frag: pasteFrag, uniforms: { texture: this.regl.prop("texture") }, framebuffer: this.regl.prop("framebuffer") });
    this.accumulate = this.regl({ ...common, frag: accumulateFrag, uniforms: { incidentTexture: this.regl.prop("incidentTexture"), lightTexture: this.regl.prop("lightTexture") }, framebuffer: this.regl.prop("framebuffer") });

    this.pingpong = [
      this.regl.framebuffer({ colorType: "float", depth: false }),
      this.regl.framebuffer({ colorType: "float", depth: false }),
    ];
    this.fbLight = this.regl.framebuffer({ colorType: "float", depth: false });
    this.starPositionTexture = this.regl.texture({ type: "float", format: "rgb" });
    this.starColorTexture = this.regl.texture({ type: "float", format: "rgb" });
  }

  render(width: number, height: number, options: any = {}) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
      this.pingpong[0].resize(width, height); this.pingpong[1].resize(width, height); this.fbLight.resize(width, height);
    }
    const viewport = { x: 0, y: 0, width, height };

    this.regl.clear({ color: [0,0,0,1], framebuffer: this.pingpong[0] });
    this.regl.clear({ color: [0,0,0,0], framebuffer: this.fbLight });
    this.regl.clear({ color: [0,0,0,0], framebuffer: this.pingpong[1] });

    // Generujemy gwiazdy oświetlające
    let stars = options.stars || [];
    if (stars.length === 0) {
       for(let i=0; i<50; i++) stars.push({ 
           position: [Math.random()*4000-2000, Math.random()*4000-2000, Math.random()*500], 
           color: [2.0, 2.0, 3.0] // Bardzo jasne gwiazdy
       });
    }

    this.starPositionTexture({ data: stars.flatMap((s:any)=>s.position), width: stars.length, height: 1, type: "float", format: "rgb" });
    this.starColorTexture({ data: stars.flatMap((s:any)=>s.color), width: stars.length, height: 1, type: "float", format: "rgb" });

    // 1. TŁO
    this.renderBackground({ ...options, viewport, framebuffer: this.pingpong[0] });
    this.paste({ resolution: [width, height], texture: this.pingpong[0], viewport });

    // 2. MGŁAWICE
    let pingIndex = 0;
    for (let i = 0; i < (options.nebulaLayers || 3); i++) {
      const depth = options.nebulaFar - (i * (options.nebulaFar - options.nebulaNear)) / Math.max(1, (options.nebulaLayers||3) - 1);
      
      this.regl.clear({ color: [0,0,0,0], framebuffer: this.fbLight });
      this.renderNebula({ ...options, depth, nStars: stars.length, viewport, framebuffer: this.fbLight });
      this.accumulate({ incidentTexture: this.pingpong[pingIndex], lightTexture: this.fbLight, viewport, framebuffer: this.pingpong[1 - pingIndex] });
      
      pingIndex = 1 - pingIndex;
    }

    // Wynik
    this.regl.clear({ color: [0,0,0,1] });
    this.paste({ texture: this.pingpong[pingIndex], viewport });
    
    return this.canvas;
  }
}

function renderConfigDefaults() {
  return {
    scale: 0.0008, 
    offset: [0, 0],
    
    backgroundColor: [0.01, 0.01, 0.03],
    backgroundDepth: 137,
    backgroundLacunarity: 2,
    backgroundGain: 0.5,
    backgroundDensity: 0.8,
    backgroundOctaves: 8,
    backgroundFalloff: 4,
    backgroundScale: 0.003,
    
    nebulaNear: 0,
    nebulaFar: 1000,
    nebulaLayers: 4,
    nebulaAbsorption: 0.5,
    nebulaLacunarity: 2.2,
    nebulaDensity: 0.6,
    nebulaGain: 0.6,
    nebulaOctaves: 8,
    nebulaFalloff: 2.5,
    
    nebulaEmissiveLow: [0.1, 0.0, 0.2],
    nebulaEmissiveHigh: [0.5, 0.2, 0.8],
    nebulaEmissiveOffset: [0, 0, 0],
    nebulaEmissiveScale: 1,
    
    nebulaAlbedoLow: [0.2, 0.2, 0.5],
    nebulaAlbedoHigh: [0.9, 0.9, 1.0],
    nebulaAlbedoOffset: [0, 0, 0],
    nebulaAlbedoScale: 1,
    
    stars: [],
  };
}
