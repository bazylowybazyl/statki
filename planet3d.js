(function(){
  const planets = [];
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  function makePRNG(seed = 1337) {
    let s = seed >>> 0;
    return () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeValueNoise(rand, w, h) {
    const g = [];
    for (let y = 0; y <= h; y++) { g[y] = []; for (let x = 0; x <= w; x++) g[y][x] = rand(); }
    return (u, v) => {
      u = (u % 1 + 1) % 1; v = clamp(v, 0, 1);
      const X = Math.floor(u * w), Y = Math.floor(v * h);
      const xf = u * w - X, yf = v * h - Y;
      const x1 = (X + 1) % (w + 1); const y1 = Math.min(Y + 1, h);
      const a = g[Y][X], b = g[Y][x1], c = g[y1][X], d = g[y1][x1];
      const s = xf * xf * (3 - 2 * xf), t = yf * yf * (3 - 2 * yf);
      return a * (1 - s) * (1 - t) + b * s * (1 - t) + c * (1 - s) * t + d * s * t;
    };
  }
  const bump = (u, v, uc, vc, sx, sy) => {
    let du = Math.min(Math.abs(u - uc), 1 - Math.abs(u - uc));
    let dv = v - vc;
    return Math.exp(-((du * du) / (sx * sx) + (dv * dv) / (sy * sy)));
  };

  function generateEarthTextures(sizeX = 1024, sizeY = 512) {
    const rand = makePRNG(1337421);
    const baseNoise = makeValueNoise(rand, 256, 128);
    const roughNoise = makeValueNoise(rand, 512, 256);
    const day = document.createElement("canvas"); day.width = sizeX; day.height = sizeY;
    const night = document.createElement("canvas"); night.width = sizeX; night.height = sizeY;
    const dctx = day.getContext("2d");
    const nctx = night.getContext("2d");
    const dimg = dctx.createImageData(sizeX, sizeY);
    const nimg = nctx.createImageData(sizeX, sizeY);

    function isLand(u, v) {
      const latAbs = Math.abs(v - 0.5) * 2;
      const guide =
        1.35 * bump(u, v, 0.18, 0.42, 0.10, 0.12) +
        1.15 * bump(u, v, 0.23, 0.64, 0.07, 0.10) +
        1.55 * bump(u, v, 0.52, 0.42, 0.22, 0.12) +
        1.25 * bump(u, v, 0.53, 0.58, 0.12, 0.14) +
        0.90 * bump(u, v, 0.74, 0.62, 0.06, 0.06);
      const base = baseNoise(u * 3.2, v * 2.0);
      const detail = roughNoise(u * 6.0, v * 3.0);
      let landMask = base * 0.6 + detail * 0.25 + guide * 0.35;
      landMask -= 0.52 + (latAbs - 0.5) * 0.05;
      return landMask > 0;
    }

    for (let y = 0; y < sizeY; y++) {
      const v = y / (sizeY - 1);
      const latAbs = Math.abs(v - 0.5) * 2;
      for (let x = 0; x < sizeX; x++) {
        const u = x / (sizeX - 1);
        const guide =
          1.35 * bump(u, v, 0.18, 0.42, 0.10, 0.12) +
          1.15 * bump(u, v, 0.23, 0.64, 0.07, 0.10) +
          1.55 * bump(u, v, 0.52, 0.42, 0.22, 0.12) +
          1.25 * bump(u, v, 0.53, 0.58, 0.12, 0.14) +
          0.90 * bump(u, v, 0.74, 0.62, 0.06, 0.06);
        const base = baseNoise(u * 3.2, v * 2.0);
        const detail = roughNoise(u * 6.0, v * 3.0);
        let landMask = base * 0.6 + detail * 0.25 + guide * 0.35;
        landMask -= 0.52 + (latAbs - 0.5) * 0.05;
        const land = landMask > 0;
        const elev = clamp((detail - 0.5) * 1.6 + (base - 0.5) * 0.6 + guide * 0.2, -1, 1);

        let rD, gD, bD;
        if (land) {
          const green = 0.35 + 0.25 * (1 - latAbs);
          const brown = elev > 0.25 ? 0.25 + (elev - 0.25) * 0.8 : 0.0;
          rD = 0.18 + brown;
          gD = 0.35 + green * 0.8;
          bD = 0.16 + green * 0.2;
        } else {
          const ocean = 0.55 + 0.18 * (roughNoise(u * 0.5, v * 0.5) - 0.5);
          rD = 0.10 * ocean;
          gD = 0.30 * ocean;
          bD = 0.65 * ocean;
        }
        const di = (y * sizeX + x) * 4;
        dimg.data[di] = (clamp(rD) * 255) | 0;
        dimg.data[di + 1] = (clamp(gD) * 255) | 0;
        dimg.data[di + 2] = (clamp(bD) * 255) | 0;
        dimg.data[di + 3] = 255;

        let city = 0;
        if (land && latAbs < 0.85) {
          const urban = roughNoise(u * 8, v * 8);
          if (urban > 0.72 && rand() > 0.6) {
            city = Math.pow(clamp(urban), 4);
          }
        }
        const ni = (y * sizeX + x) * 4;
        nimg.data[ni] = 255 * city;
        nimg.data[ni + 1] = 220 * city;
        nimg.data[ni + 2] = 180 * city;
        nimg.data[ni + 3] = 255;
      }
    }
    dctx.putImageData(dimg, 0, 0);
    nctx.putImageData(nimg, 0, 0);
    return { day, night, isLand };
  }

  function addZones(dctx, sizeX, sizeY, isLand) {
    const placements = [
      { count: 50, color: "#bbbbbb", rMin: 2, rMax: 3 }, // miasta
      { count: 25, color: "#5ac1ff", rMin: 4, rMax: 8 }, // komercyjne
      { count: 25, color: "#caa15a", rMin: 4, rMax: 8 }  // fabryczne
    ];
    for (const p of placements) {
      for (let i = 0; i < p.count; i++) {
        let u, v;
        do { u = Math.random(); v = Math.random(); } while (!isLand(u, v));
        const x = u * sizeX, y = v * sizeY;
        const r = p.rMin + Math.random() * (p.rMax - p.rMin);
        dctx.beginPath();
        dctx.fillStyle = p.color;
        dctx.globalAlpha = 0.8;
        dctx.arc(x, y, r, 0, TAU);
        dctx.fill();
      }
    }
    dctx.globalAlpha = 1;
  }

  const tex = generateEarthTextures(1024, 512);
  addZones(tex.day.getContext("2d"), tex.day.width, tex.day.height, tex.isLand);
  const sharedDayMap = new THREE.CanvasTexture(tex.day);
  const sharedNightMap = new THREE.CanvasTexture(tex.night);
  sharedDayMap.needsUpdate = true;
  sharedNightMap.needsUpdate = true;

  class Planet3D {
    constructor(size) {
      this.size = size;
      this.canvas = document.createElement("canvas");
      this.canvas.width = 256;
      this.canvas.height = 256;
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this.renderer.setSize(256, 256);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      this.camera.position.z = 3;

      const material = new THREE.MeshPhongMaterial({
        map: sharedDayMap,
        emissiveMap: sharedNightMap,
        emissive: new THREE.Color(0x222222),
        emissiveIntensity: 1.0
      });
      this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), material);
      this.scene.add(this.mesh);
      const amb = new THREE.AmbientLight(0x404040);
      this.scene.add(amb);
      const dir = new THREE.DirectionalLight(0xffffff, 1.1);
      dir.position.set(5, 3, 5);
      this.scene.add(dir);
      this.spin = 0.2 + Math.random() * 0.2;
    }
    render(dt) {
      this.mesh.rotation.y += this.spin * dt;
      this.renderer.render(this.scene, this.camera);
    }
  }

  function initPlanets3D(stations) {
    for (const st of stations) {
      const p = new Planet3D(st.r * 8);
      p.x = st.x;
      p.y = st.y;
      planets.push(p);
    }
  }

  function updatePlanets3D(dt) {
    for (const p of planets) p.render(dt);
  }

  function drawPlanets3D(ctx, cam) {
    for (const p of planets) {
      const s = worldToScreen(p.x, p.y, cam);
      const size = p.size * camera.zoom;
      ctx.drawImage(p.canvas, s.x - size / 2, s.y - size / 2, size, size);
    }
  }

  window.initPlanets3D = initPlanets3D;
  window.updatePlanets3D = updatePlanets3D;
  window.drawPlanets3D = drawPlanets3D;
})();
