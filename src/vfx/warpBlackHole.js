export class WarpBlackHole {
  constructor({ zIndex = 999999 } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${zIndex}`;
    document.body.appendChild(this.canvas);

    const gl = this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error('WebGL not available');

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquation(gl.FUNC_ADD);
    gl.clearColor(0, 0, 0, 0);

    this.program = this._createProgram(
      this._vs(), this._fs()
    );

    // lookups
    this.u_resolution  = gl.getUniformLocation(this.program, 'u_resolution');
    this.u_center      = gl.getUniformLocation(this.program, 'u_center');
    this.u_mass        = gl.getUniformLocation(this.program, 'u_mass');
    this.u_time        = gl.getUniformLocation(this.program, 'u_time');
    this.u_radius      = gl.getUniformLocation(this.program, 'u_radius');
    this.u_softness    = gl.getUniformLocation(this.program, 'u_softness');
    this.u_image       = gl.getUniformLocation(this.program, 'u_image');
    this.u_tileSize    = gl.getUniformLocation(this.program, 'u_tileSize');
    this.u_tileOffset  = gl.getUniformLocation(this.program, 'u_tileOffset');
    this.u_parallax    = gl.getUniformLocation(this.program, 'u_parallaxEnabled');
    this.u_rotation    = gl.getUniformLocation(this.program, 'u_rotation');
    this.u_opacity     = gl.getUniformLocation(this.program, 'u_opacity');

    // fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,-1,  +1,-1,  -1,+1,
      -1,+1,  +1,-1,  +1,+1
    ]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    // texture
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.enabled = false;
    this._time0 = performance.now();
    this._srcCanvas = null; // co próbkujemy: tło lub całą scenę
    this._warnedNoSource = false;
    this._parallax = null;
    this._resize();
    addEventListener('resize', () => this._resize());
  }

  setSourceCanvas(canvas) {
    this._srcCanvas = canvas;
    this._warnedNoSource = false;
  }
  setSourceParallaxTransform(descriptor) {
    if (!descriptor) {
      this._parallax = null;
      return;
    }
    const { tileWidth, tileHeight, offsetX, offsetY, parallaxEnabled } = descriptor;
    if (!parallaxEnabled || !tileWidth || !tileHeight) {
      this._parallax = null;
      return;
    }
    this._parallax = {
      tileWidth,
      tileHeight,
      offsetX,
      offsetY
    };
  }
  setEnabled(flag)       { this.enabled = !!flag; this.canvas.style.display = this.enabled?'block':'none'; }
  destroy(){ this.canvas?.remove(); }

  _resize(){
    const dpr = Math.min(devicePixelRatio||1, 2);
    this.canvas.width  = Math.round(innerWidth  * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    this.canvas.style.width  = innerWidth+'px';
    this.canvas.style.height = innerHeight+'px';
    this.gl.viewport(0,0,this.canvas.width, this.canvas.height);
  }

  render({ centerX, centerY, mass = 0.15, radius = 0.25, softness = 0.25, rotation = 0, opacity = 0.85 }){
    if (!this.enabled) return;
    if (!this._srcCanvas) {
      if (!this._warnedNoSource) {
        console.warn('[WarpBlackHole] Missing source canvas for warp lens.');
        this._warnedNoSource = true;
      }
      return;
    }
    const gl = this.gl;
    const t = (performance.now() - this._time0) * 0.001;
    const dpr = Math.min(devicePixelRatio||1, 2);
    const cx = centerX * dpr;
    const cy = centerY * dpr;

    const parallax = this._parallax;
    const useParallax = !!(parallax && parallax.tileWidth > 0 && parallax.tileHeight > 0);
    const tileW = useParallax ? parallax.tileWidth * dpr : 1;
    const tileH = useParallax ? parallax.tileHeight * dpr : 1;
    const offsetX = useParallax ? parallax.offsetX * dpr : 0;
    const offsetY = useParallax ? parallax.offsetY * dpr : 0;

    gl.useProgram(this.program);

    // upload source image (Twoja kanwa 2D – tło albo cała scena)
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // UWAGA: texSubImage2D gdy rozmiar się nie zmienia – szybciej
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
                  gl.UNSIGNED_BYTE, this._srcCanvas);

    gl.uniform2f(this.u_resolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u_time, t);
    // przekazujemy środek w pikselach, shader sam przeskaluje
    gl.uniform2f(this.u_center, cx, this.canvas.height - cy);
    gl.uniform1f(this.u_mass, mass);        // siła zakrzywienia (0..~0.5)
    gl.uniform1f(this.u_radius, radius);    // promień soczewki (0..1) — 0.25 ~ 25% ekranu
    gl.uniform1f(this.u_softness, softness);// miękkość brzegów (0..1)
    if (this.u_rotation) gl.uniform1f(this.u_rotation, rotation);
    if (this.u_opacity) gl.uniform1f(this.u_opacity, opacity);
    gl.uniform1i(this.u_image, 0);
    gl.uniform1f(this.u_parallax, useParallax ? 1 : 0);
    gl.uniform2f(this.u_tileSize, tileW, tileH);
    gl.uniform2f(this.u_tileOffset, offsetX, offsetY);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ———— SHADERS ————
  _vs(){ return `
    attribute vec2 a_position;
    void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }
  `;}

  _fs(){ return `
    precision mediump float;
    uniform sampler2D u_image;
    uniform vec2  u_resolution;   // w px
    uniform vec2  u_center;       // w px (od dołu)
    uniform float u_mass;         // siła odchylenia
    uniform float u_radius;       // promień soczewki (0..1 ekranu)
    uniform float u_softness;     // miękkie brzegi (0..1)
    uniform float u_time;
    uniform vec2  u_tileSize;     // rozmiar kafla tła (w px, po dpr)
    uniform vec2  u_tileOffset;   // przesunięcie kafla (w px, po dpr)
    uniform float u_parallaxEnabled;
    uniform float u_rotation;     // orientacja statku (rad)
    uniform float u_opacity;      // globalna intensywność (0..1)

    // Prosta soczewka grawitacyjna:
    // - liczymy kierunek do centrum, wielkość odchylenia ~ u_mass / r^2
    // - miękka maska w promieniu u_radius (współczynnik mix)
    void main(){
      vec2 frag = gl_FragCoord.xy;
      vec2 res  = u_resolution;
      vec2 st   = frag / res;                 // 0..1
      vec2 c    = u_center / res;

      vec2 v  = st - c;

      float cs = cos(u_rotation);
      float sn = sin(u_rotation);
      vec2 right = vec2(cs, sn);
      vec2 forward = vec2(sn, -cs);
      vec2 local = vec2(dot(v, right), dot(v, forward));
      vec2 lensStretch = vec2(1.0, 0.55);
      vec2 scaled = vec2(local.x / max(lensStretch.x, 1e-4), local.y / max(lensStretch.y, 1e-4));
      float r2 = dot(scaled, scaled) + 1e-4;
      float r  = sqrt(r2);

      // maska w promieniu — bez ostrych krawędzi
      float R = u_radius;
      float falloff = R * (0.6 + 0.6 * u_softness) + 1e-3;
      float lens = 1.0 - smoothstep(R, R + falloff, r);

      // odchylenie (w kierunku do centrum)
      float pull = clamp(u_mass / r2, 0.0, 0.45);
      vec2 dir = (length(v) > 1e-4) ? normalize(v) : vec2(0.0);
      vec2 uv   = st - dir * pull * lens;

      if (u_parallaxEnabled > 0.5) {
        vec2 tileSize = max(u_tileSize, vec2(1.0));
        vec2 samplePx = uv * u_resolution + u_tileOffset;
        vec2 tileUv = fract(samplePx / tileSize);
        uv = tileUv;
      }

      // sample
      vec4 col = texture2D(u_image, uv);
      float alpha = pow(lens, 1.25) * clamp(u_opacity, 0.0, 1.0);
      if (alpha <= 0.001) {
        discard;
      }
      gl_FragColor = vec4(col.rgb, col.a * alpha);
    }
  `;}

  _createProgram(vsSrc, fsSrc){
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, fsSrc); gl.compileShader(fs);

    const p  = gl.createProgram();
    gl.attachShader(p,vs); gl.attachShader(p,fs);
    gl.linkProgram(p); gl.useProgram(p);
    return p;
  }
}
