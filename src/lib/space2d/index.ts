import REGL from "regl";
import Alea from "alea";

// Import shaderów (zakładam, że masz je w folderze glsl/ obok)
import fullscreenQuadVertex from "./glsl/full-screen-quad.vs?raw";
import nebulaFragment from "./glsl/nebula.fs?raw";
import starFragment from "./glsl/star.fs?raw";
import starsFragment from "./glsl/stars.fs?raw";
import backgroundFragment from "./glsl/background.fs?raw";
import pasteFragment from "./glsl/paste.fs?raw";
import accumulateFragment from "./glsl/accumulate.fs?raw";

export class Space2D {
  private canvas: HTMLCanvasElement;
  private regl: REGL.Regl;
  private renderStars: REGL.DrawCommand;
  private renderBackground: REGL.DrawCommand;
  private renderNebula: REGL.DrawCommand;
  private renderStar: REGL.DrawCommand;
  private paste: REGL.DrawCommand;
  private accumulate: REGL.DrawCommand;
  private pingpong: REGL.Framebuffer2D[];
  private fbLight: REGL.Framebuffer2D;
  private starPositionTexture: REGL.Texture2D;
  private starColorTexture: REGL.Texture2D;

  constructor() {
    // Tworzymy offscreen canvas
    this.canvas = document.createElement("canvas");
    this.canvas.width = 1; // Tymczasowo
    this.canvas.height = 1;
    
    // Inicjalizacja REGL z odpowiednimi rozszerzeniami
    this.regl = REGL({
      canvas: this.canvas,
      attributes: {
        preserveDrawingBuffer: true,
        alpha: false, // Tło nieprzezroczyste (ważne dla blendingu wewnątrz REGL)
        depth: false,
        stencil: false,
        antialias: false
      },
      extensions: ["OES_texture_float", "OES_texture_half_float"], // Potrzebne do HDR
      optionalExtensions: ["OES_texture_float_linear", "OES_texture_half_float_linear"]
    });

    const prng = Alea("seed-statki");

    // Generowanie tekstury szumu dla gwiazd
    const starSize = 1024;
    const rawStarData = new Uint8ClampedArray(starSize * starSize * 4);
    for (let i = 0; i < rawStarData.length; i++) {
      rawStarData[i] = Math.floor(prng() * 256);
    }

    const starTexture = this.regl.texture({
      data: rawStarData,
      width: starSize,
      height: starSize,
      format: "rgba", // Ważne: RGBA dla kompatybilności
      wrap: "repeat",
      mag: "linear",
      min: "linear"
    });

    // --- KOMENDY RYSOWANIA (Shadery) ---

    // 1. Gwiazdy tła (małe kropki)
    this.renderStars = this.regl({
      vert: fullscreenQuadVertex,
      frag: starsFragment,
      attributes: { position: [-4, -4, 4, -4, 0, 4] },
      uniforms: {
        starTexture,
        offset: this.regl.prop<any, any>("offset"),
        density: this.regl.prop<any, any>("density"),
        brightness: this.regl.prop<any, any>("brightness"),
        resolution: [starSize, starSize],
      },
      depth: { enable: false },
      count: 3,
      viewport: this.regl.prop<any, any>("viewport"),
      framebuffer: this.regl.prop<any, any>("framebuffer"),
    });

    // 2. Tło (Gradient / Głęboki kosmos)
    this.renderBackground = this.regl({
      vert: fullscreenQuadVertex,
      frag: backgroundFragment,
      attributes: { position: [-4, -4, 4, -4, 0, 4] },
      uniforms: {
        depth: this.regl.prop<any, any>("depth"),
        color: this.regl.prop<any, any>("color"),
        scale: this.regl.prop<any, any>("scale"),
        lacunarity: this.regl.prop<any, any>("lacunarity"),
        gain: this.regl.prop<any, any>("gain"),
        octaves: this.regl.prop<any, any>("octaves"),
        density: this.regl.prop<any, any>("density"),
        falloff: this.regl.prop<any, any>("falloff"),
        offset: this.regl.prop<any, any>("offset"),
        resolution: this.regl.prop<any, any>("resolution"),
      },
      depth: { enable: false },
      blend: {
        enable: true,
        func: { src: "one", dst: "one" }, // Additive blending
      },
      count: 3,
      viewport: this.regl.prop<any, any>("viewport"),
      framebuffer: this.regl.prop<any, any>("framebuffer"),
    });

    // 3. MGŁAWICE (To jest to, na czym nam zależy!)
    this.renderNebula = this.regl({
      vert: fullscreenQuadVertex,
      frag: nebulaFragment,
      attributes: { position: [-4, -4, 4, -4, 0, 4] },
      uniforms: {
        depth: this.regl.prop<any, any>("depth"),
        // Tekstury gwiazd służą tu jako źródła światła dla mgławicy
        starPositionTexture: this.regl.prop<any, any>("starPositionTexture"),
        starColorTexture: this.regl.prop<any, any>("starColorTexture"),
        nStars: this.regl.prop<any, any>("nStars"),
        
        scale: this.regl.prop<any, any>("scale"),
        absorption: this.regl.prop<any, any>("absorption"),
        
        emissiveLow: this.regl.prop<any, any>("emissiveLow"),
        emissiveHigh: this.regl.prop<any, any>("emissiveHigh"),
        emissiveOffset: this.regl.prop<any, any>("emissiveOffset"),
        emissiveScale: this.regl.prop<any, any>("emissiveScale"),
        
        albedoLow: this.regl.prop<any, any>("albedoLow"),
        albedoHigh: this.regl.prop<any, any>("albedoHigh"),
        albedoOffset: this.regl.prop<any, any>("albedoOffset"),
        albedoScale: this.regl.prop<any, any>("albedoScale"),
        
        lacunarity: this.regl.prop<any, any>("lacunarity"),
        gain: this.regl.prop<any, any>("gain"),
        octaves: this.regl.prop<any, any>("octaves"),
        density: this.regl.prop<any, any>("density"),
        falloff: this.regl.prop<any, any>("falloff"),
        offset: this.regl.prop<any, any>("offset"),
      },
      depth: { enable: false },
      blend: {
        enable: true,
        func: { src: "one", dst: "one" }, // Additive blending
      },
      count: 3,
      viewport: this.regl.prop<any, any>("viewport"),
      framebuffer: this.regl.prop<any, any>("framebuffer"),
    });

    // 4. Jasne gwiazdy (Flare)
    this.renderStar = this.regl({
      vert: fullscreenQuadVertex,
      frag: starFragment,
      attributes: { position: [-4, -4, 4, -4, 0, 4] },
      uniforms: {
        position: this.regl.prop<any, any>("position"),
        color: this.regl.prop<any, any>("color"),
        diffractionSpikeFalloff: this.regl.prop<any, any>("diffractionSpikeFalloff"),
        diffractionSpikeScale: this.regl.prop<any, any>("diffractionSpikeScale"),
        scale: this.regl.prop<any, any>("scale"),
        falloff: this.regl.prop<any, any>("falloff"),
        offset: this.regl.prop<any, any>("offset"),
        resolution: this.regl.prop<any, any>("resolution"),
      },
      depth: { enable: false },
      blend: {
        enable: true,
        func: { src: "one", dst: "one" },
      },
      count: 3,
      viewport: this.regl.prop<any, any>("viewport"),
      framebuffer: this.regl.prop<any, any>("framebuffer"),
    });

    // Narzędzia pomocnicze
    this.paste = this.regl({
      vert: fullscreenQuadVertex,
      frag: pasteFragment,
      attributes: { position: [-4, -4, 4, -4, 0, 4] },
      uniforms: {
        texture: this.regl.prop<any, any>("texture"),
        resolution: this.regl.prop<any, any>("resolution"),
      },
      depth: { enable: false },
      count: 3,
      viewport: this.regl.prop<any, any>("viewport"),
      framebuffer: this.regl.prop<any, any>("framebuffer"),
    });

    this.accumulate = this.regl({
      vert: fullscreenQuadVertex,
      frag: accumulateFragment,
      attributes: { position: [-4, -4, 4, -4, 0, 4] },
      uniforms: {
        incidentTexture: this.regl.prop<any, any>("incidentTexture"),
        lightTexture: this.regl.prop<any, any>("lightTexture"),
        resolution: this.regl.prop<any, any>("resolution"),
      },
      depth: { enable: false },
      count: 3,
      viewport: this.regl.prop<any, any>("viewport"),
      framebuffer: this.regl.prop<any, any>("framebuffer"),
    });

    // Framebuffery do efektów post-process (ping-pong)
    this.pingpong = [
      this.regl.framebuffer({ colorType: "half float", depth: false }), // Używamy half float dla HDR
      this.regl.framebuffer({ colorType: "half float", depth: false }),
    ];

    this.fbLight = this.regl.framebuffer({ colorType: "half float", depth: false });
    this.starPositionTexture = this.regl.texture({ type: "float", format: "rgb" });
    this.starColorTexture = this.regl.texture({ type: "float", format: "rgb" });
  }

  // --- GŁÓWNA FUNKCJA RENDERUJĄCA ---
  render(width: number, height: number, options: RenderOptions = {}) {
    // Łączymy domyślne opcje z przekazanymi
    const opts = { ...renderConfigDefaults(), ...options };

    // Resize jeśli trzeba
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.pingpong[0].resize(width, height);
      this.pingpong[1].resize(width, height);
      this.fbLight.resize(width, height);
    }

    const viewport = { x: 0, y: 0, width, height };

    // Czyścimy bufory
    this.regl.clear({ color: [0, 0, 0, 1] }); // Tło czarne
    this.regl.clear({ color: [0, 0, 0, 0], framebuffer: this.fbLight });
    this.regl.clear({ color: [0, 0, 0, 0], framebuffer: this.pingpong[0] });
    this.regl.clear({ color: [0, 0, 0, 0], framebuffer: this.pingpong[1] });

    let pingIndex = 0;

    // Generujemy "gwiazdy oświetlające" (niewidoczne, ale dają kolor chmurom)
    // Jeśli lista gwiazd jest pusta, dodajemy jedną białą, żeby coś świeciło
    const lightingStars = opts.stars.length > 0 ? opts.stars : generateProceduralStars(20);

    this.starPositionTexture({
      data: lightingStars.flatMap((s) => s.position),
      width: lightingStars.length,
      height: 1,
      type: "float",
      format: "rgb",
    });

    this.starColorTexture({
      data: lightingStars.flatMap((s) => s.color),
      width: lightingStars.length,
      height: 1,
      type: "float",
      format: "rgb",
    });

    // 1. Rysuj małe gwiazdki tła (opcjonalne, wyłączane przez parametr density=0)
    if (opts.backgroundStarDensity > 0) {
        this.renderStars({
        offset: opts.offset,
        density: opts.backgroundStarDensity,
        brightness: opts.backgroundStarBrightness,
        viewport,
        framebuffer: this.pingpong[0],
        });
    }

    // 2. Rysuj głębokie tło (gradient)
    this.renderBackground({
      color: opts.backgroundColor,
      depth: opts.backgroundDepth,
      resolution: [width, height],
      offset: opts.offset,
      lacunarity: opts.backgroundLacunarity,
      gain: opts.backgroundGain,
      density: opts.backgroundDensity,
      octaves: opts.backgroundOctaves,
      falloff: opts.backgroundFalloff,
      scale: opts.backgroundScale,
      viewport,
      framebuffer: this.pingpong[0],
    });

    // Kopiujemy wynik do tekstury ping-pong
    this.paste({
      resolution: [width, height],
      texture: this.pingpong[0],
      viewport,
    });

    // 3. Rysuj MGŁAWICE (Warstwowo)
    // To jest pętla, która buduje głębię chmur
    for (let i = 0; i < opts.nebulaLayers; i++) {
      const depth = opts.nebulaFar - (i * (opts.nebulaFar - opts.nebulaNear)) / Math.max(1, opts.nebulaLayers - 1);
      
      this.regl.clear({ color: [0, 0, 0, 0], framebuffer: this.fbLight });
      
      this.renderNebula({
        depth,
        starPositionTexture: this.starPositionTexture,
        starColorTexture: this.starColorTexture,
        nStars: lightingStars.length,
        offset: opts.offset,
        absorption: opts.nebulaAbsorption,
        lacunarity: opts.nebulaLacunarity,
        gain: opts.nebulaGain,
        
        albedoLow: opts.nebulaAlbedoLow,
        albedoHigh: opts.nebulaAlbedoHigh,
        albedoOffset: opts.nebulaAlbedoOffset,
        albedoScale: opts.nebulaAlbedoScale,
        
        emissiveLow: opts.nebulaEmissiveLow,
        emissiveHigh: opts.nebulaEmissiveHigh,
        emissiveOffset: opts.nebulaEmissiveOffset,
        emissiveScale: opts.nebulaEmissiveScale,
        
        density: opts.nebulaDensity,
        octaves: opts.nebulaOctaves,
        falloff: opts.nebulaFalloff,
        scale: opts.scale,
        viewport,
        framebuffer: this.fbLight,
      });

      this.accumulate({
        resolution: [width, height],
        incidentTexture: this.pingpong[pingIndex],
        lightTexture: this.fbLight,
        viewport,
        framebuffer: this.pingpong[1 - pingIndex],
      });
      pingIndex = 1 - pingIndex;
    }

    // 4. Rysuj jasne gwiazdy (Flare) na wierzchu
    for (const star of lightingStars) {
        // Rysujemy tylko te, które mają być widoczne
      if (star.visible !== false) {
          this.renderStar({
            position: star.position,
            color: star.color,
            falloff: star.falloff || 1,
            diffractionSpikeFalloff: star.diffractionSpikeFalloff || 0,
            diffractionSpikeScale: star.diffractionSpikeScale || 0,
            offset: opts.offset,
            scale: opts.scale,
            resolution: [width, height],
            viewport,
            framebuffer: this.pingpong[pingIndex],
          });
      }
    }

    // 5. Finalny rzut na canvas
    this.paste({
      resolution: [width, height],
      texture: this.pingpong[pingIndex],
      viewport,
    });

    // Zwracamy canvas, z którego można czytać (drawImage)
    return this.canvas;
  }
}

export interface Star {
  position: number[];
  color: number[];
  falloff?: number;
  diffractionSpikeFalloff?: number;
  diffractionSpikeScale?: number;
  visible?: boolean; // Nowe pole: czy gwiazda ma być widoczna (czy tylko oświetlać)
}

export type RenderOptions = Partial<ReturnType<typeof renderConfigDefaults>>;

// Helper do generowania losowych gwiazd oświetlających
function generateProceduralStars(count: number): Star[] {
    const stars: Star[] = [];
    for(let i=0; i<count; i++) {
        stars.push({
            position: [Math.random()*2000 - 1000, Math.random()*2000 - 1000, Math.random()*500],
            color: [Math.random(), Math.random(), Math.random()].map(c => c * 2.0), // Jasne kolory
            visible: false // Domyślnie niewidoczne, tylko świecą
        });
    }
    return stars;
}

function renderConfigDefaults() {
  return {
    scale: 0.001, // Skala szumu (mniejsza = większe chmury)
    offset: [0, 0],
    
    // Tło
    backgroundColor: [0.02, 0.02, 0.05], // Bardzo ciemny granat (nie idealna czerń)
    backgroundDepth: 137,
    backgroundLacunarity: 2,
    backgroundGain: 0.5,
    backgroundDensity: 1.0,
    backgroundOctaves: 8,
    backgroundFalloff: 4,
    backgroundScale: 0.003,
    backgroundStarDensity: 0.0,
    backgroundStarBrightness: 0.1,
    
    // Mgławice (Parametry kluczowe dla wyglądu)
    nebulaNear: 0,
    nebulaFar: 1000,
    nebulaLayers: 10,     // Ilość warstw (im więcej tym gęściej, ale wolniej)
    nebulaAbsorption: 0.8, // Jak bardzo mgławica pochłania światło z tyłu
    nebulaLacunarity: 2.2,
    nebulaDensity: 0.5,    // Gęstość chmur
    nebulaGain: 0.6,
    nebulaOctaves: 8,
    nebulaFalloff: 2.5,    // Jak szybko zanika na brzegach
    
    // Kolory emisyjne (świecenie własne mgławicy)
    // Ustawiamy tu ładne kolory "kosmiczne" domyślnie
    nebulaEmissiveLow: [0.0, 0.05, 0.2],  // Ciemny błękit
    nebulaEmissiveHigh: [0.8, 0.2, 0.5],  // Róż/Fiolet
    nebulaEmissiveOffset: [0, 0, 0],
    nebulaEmissiveScale: 1,
    
    // Kolory odbite (Albedo - jak chmura odbija światło gwiazd)
    nebulaAlbedoLow: [0.1, 0.1, 0.3],
    nebulaAlbedoHigh: [0.8, 0.8, 1.0],
    nebulaAlbedoOffset: [0, 0, 0],
    nebulaAlbedoScale: 1,
    
    stars: [] as Star[],
  };
}
