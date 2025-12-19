import * as THREE from "three";

// --- SHADERS (GLSL) ---

const shockVertex = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const shockFragment = `
    uniform float progress;
    uniform float uGlobalFade;
    uniform float uOpacity; 
    varying vec2 vUv;
    
    void main() {
        // Dystans od środka UV (0.5, 0.5)
        float dist = distance(vUv, vec2(0.5));
        
        // Ring effect
        float ringWidth = 0.15;
        float ringRadius = 0.5 * progress; // Rośnie z czasem
        
        // Kształt pierścienia
        float ring = smoothstep(ringRadius, ringRadius - 0.05, dist) * smoothstep(ringRadius - ringWidth, ringRadius - 0.02, dist);
        
        // Iskry/Szum w pierścieniu
        float sparks = sin(vUv.x * 80.0 + progress * 30.0) * 0.5 + 0.5;
        ring *= (0.6 + sparks * 0.4);

        vec3 color = vec3(0.1, 0.9, 1.0) * 3.0; // Bardzo jasny cyjan
        
        float fade = 1.0 - smoothstep(0.5, 1.0, progress);
        float alpha = ring * fade * uGlobalFade * uOpacity;
        
        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color, alpha);
    }
`;

// --- ZASOBY WSPÓŁDZIELONE (SINGLETON) ---
const sharedResources = {
  textures: { glow: null, spark: null, glowNew: null },
  geometries: {
    sphere: null, 
    torusImplosion: null, 
    planeShock: null, 
    planeGlow: null, 
    spike: null,
  }
};

function ensureResources() {
  if (!sharedResources.textures.glow) sharedResources.textures.glow = makeSoftGlow(64, "rgba(255,255,255,1)", "rgba(100,220,255,0.4)");
  if (!sharedResources.textures.glowNew) sharedResources.textures.glowNew = makeSoftGlow(128, "rgba(0, 200, 255, 1)", "rgba(0, 50, 255, 0.2)");
  if (!sharedResources.textures.spark) sharedResources.textures.spark = makeSparkTexture(64);

  // Zmniejszone geometrie bazowe (Unit size ~1.0)
  if (!sharedResources.geometries.sphere) sharedResources.geometries.sphere = new THREE.SphereGeometry(0.5, 16, 16);
  if (!sharedResources.geometries.torusImplosion) sharedResources.geometries.torusImplosion = new THREE.TorusGeometry(1.5, 0.05, 8, 50);
  
  if (!sharedResources.geometries.planeShock) sharedResources.geometries.planeShock = new THREE.PlaneGeometry(1, 1);
  if (!sharedResources.geometries.planeGlow) sharedResources.geometries.planeGlow = new THREE.PlaneGeometry(1, 1);
  
  if (!sharedResources.geometries.spike) {
    // Stożek/Kolec: promień góry 0, dołu 0.1, wysokość 1
    sharedResources.geometries.spike = new THREE.CylinderGeometry(0, 0.1, 1, 4); 
    sharedResources.geometries.spike.translate(0, 0.5, 0); // Pivot u podstawy
    sharedResources.geometries.spike.rotateX(Math.PI / 2); // Obrót, by celował w bok (na płaszczyźnie)
  }
}

export function createReactorBlowFactory(scene) {
  ensureResources();

  return function spawn({ x = 0, y = 0, size = 100 } = {}) {
    // DEBUG: Potwierdzenie spawnu
    // console.log(`ReactorBlow spawned at: ${x}, ${y} with size: ${size}`);

    const group = new THREE.Group();
    
    // --- KLUCZOWA POPRAWKA POZYCJI ---
    // Mapujemy 2D (x, y) gry na 3D (x, 0, z)
    // Dzięki temu obiekt leży na płaszczyźnie, na którą patrzy kamera
    group.position.set(x, 0, y); 
    
    // Skala: size to promień w jednostkach gry.
    const scaleFactor = size; 
    group.scale.setScalar(scaleFactor);
    
    // RenderOrder: wymusza rysowanie NA WIERZCHU wszystkiego innego (poza UI)
    group.renderOrder = 9999;

    scene.add(group);

    // --- FAZA 1: RDZEŃ & IMPLOZJA ---
    // depthTest: false -> widać przez ściany/inne obiekty
    const coreMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x00ffff, 
        toneMapped: false, 
        transparent: true,
        depthTest: false 
    });
    const core = new THREE.Mesh(sharedResources.geometries.sphere, coreMaterial);
    group.add(core);

    const implosionMat = new THREE.MeshBasicMaterial({ 
        color: 0x00ffff, 
        transparent: true, 
        opacity: 0,
        depthTest: false 
    });
    const implosionRing = new THREE.Mesh(sharedResources.geometries.torusImplosion, implosionMat);
    // Obrót, by leżał płasko na XZ
    implosionRing.rotation.x = Math.PI / 2;
    implosionRing.scale.set(0, 0, 0);
    group.add(implosionRing);

    // Błyskawice
    const lightningPos = new Float32Array(40 * 2 * 3);
    const lightningGeo = new THREE.BufferGeometry();
    lightningGeo.setAttribute('position', new THREE.BufferAttribute(lightningPos, 3));
    const lightningMat = new THREE.LineBasicMaterial({ 
        color: 0x88ffff, 
        transparent: true, 
        opacity: 0.8, 
        blending: THREE.AdditiveBlending,
        depthTest: false
    });
    const lightning = new THREE.LineSegments(lightningGeo, lightningMat);
    lightning.visible = false;
    group.add(lightning);

    // Cząsteczki wciągane
    const pCount = 200;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for(let i=0; i<pCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = 1.5 + Math.random();
        // Rozkład na płaszczyźnie XZ
        pPos[i*3] = Math.cos(angle) * r;     // X
        pPos[i*3+1] = 0;                     // Y (płasko)
        pPos[i*3+2] = Math.sin(angle) * r;   // Z
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const particlesMat = new THREE.PointsMaterial({
        color: 0x00ffff, 
        size: 8.0, 
        map: sharedResources.textures.glow,
        blending: THREE.AdditiveBlending, 
        depthWrite: false, 
        depthTest: false, // Ważne
        transparent: true, 
        opacity: 0
    });
    const particles = new THREE.Points(pGeo, particlesMat);
    group.add(particles);

    const light = new THREE.PointLight(0x00ffff, 0, size * 2);
    light.position.set(0, 10, 0); // Lekko nad ziemią
    group.add(light);

    // --- FAZA 3: EKSPLOZJA ---
    const explosionGroup = new THREE.Group();
    explosionGroup.visible = false;
    group.add(explosionGroup);

    // Kolce (Spikes)
    const spikeCount = 16;
    const spikeGroup = new THREE.Group();
    const spikeMat = new THREE.MeshBasicMaterial({ 
        color: 0xffffff, 
        transparent: true, 
        opacity: 1, 
        blending: THREE.AdditiveBlending, 
        depthWrite: false,
        depthTest: false
    });
    const spikes = [];
    for(let i=0; i<spikeCount; i++) {
        const mesh = new THREE.Mesh(sharedResources.geometries.spike, spikeMat);
        // Obracamy wokół osi Y (płaszczyzna XZ)
        mesh.rotation.y = Math.random() * Math.PI * 2;
        mesh.userData = {
            maxScaleY: 1.5 + Math.random() * 1.5,
            widthScale: 0.5 + Math.random() * 1.0
        };
        mesh.scale.set(0,0,0);
        spikeGroup.add(mesh);
        spikes.push(mesh);
    }
    explosionGroup.add(spikeGroup);

    // Fala uderzeniowa (Shockwave)
    const ring1Mat = new THREE.ShaderMaterial({
        vertexShader: shockVertex, fragmentShader: shockFragment,
        uniforms: {
            progress: { value: 0 },
            uGlobalFade: { value: 1.0 },
            uOpacity: { value: 1.0 }
        },
        transparent: true, 
        side: THREE.DoubleSide, 
        blending: THREE.AdditiveBlending, 
        depthWrite: false,
        depthTest: false
    });
    const ring1 = new THREE.Mesh(sharedResources.geometries.planeShock, ring1Mat);
    ring1.rotation.x = -Math.PI / 2; // Płasko na ziemi
    ring1.scale.set(4, 4, 1); 
    explosionGroup.add(ring1);

    const glowMat = new THREE.MeshBasicMaterial({
        map: sharedResources.textures.glowNew, 
        transparent: true, 
        opacity: 0, 
        blending: THREE.AdditiveBlending, 
        depthWrite: false,
        depthTest: false
    });
    const glowSprite = new THREE.Mesh(sharedResources.geometries.planeGlow, glowMat);
    glowSprite.rotation.x = -Math.PI / 2; // Płasko na ziemi
    glowSprite.scale.set(5, 5, 1);
    explosionGroup.add(glowSprite);

    // Iskry
    const sparkCount = 120;
    const sparkPos = new Float32Array(sparkCount * 3);
    const sparkVel = [];
    for(let i=0; i<sparkCount; i++) {
        const speed = 0.5 + Math.random() * 1.5; 
        const angle = Math.random() * Math.PI * 2;
        // Rozrzut w płaszczyźnie XZ
        sparkVel.push({
            x: Math.cos(angle) * speed,
            y: (Math.random()) * 0.5, // Lekko w górę
            z: Math.sin(angle) * speed
        });
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
        color: 0xffffff, 
        size: 6.0, 
        map: sharedResources.textures.spark, 
        transparent: true, 
        blending: THREE.AdditiveBlending, 
        depthWrite: false,
        depthTest: false
    }));
    explosionGroup.add(sparks);

    // --- LOGIKA ANIMACJI ---
    let time = 0;
    let disposed = false;
    
    const CHARGE_TIME = 1.8;
    const IMPLOSION_DURATION = 0.6;
    const EXPLOSION_DURATION = 3.0; 
    const TOTAL_IMPLOSION_END = CHARGE_TIME + IMPLOSION_DURATION;

    function updateLightning(radius) {
        const positions = lightningGeo.attributes.position.array;
        for (let i = 0; i < 40; i++) {
            const jit = 0.1;
            // Centrum (jitter wokół 0,0,0)
            positions[i*6] = (Math.random()-0.5) * jit;
            positions[i*6+1] = (Math.random()-0.5) * jit;
            positions[i*6+2] = (Math.random()-0.5) * jit;
            
            // Koniec linii na obwodzie (XZ)
            const r = radius * (0.8 + Math.random()*0.4);
            const angle = Math.random() * Math.PI * 2;
            positions[i*6+3] = Math.cos(angle) * r;
            positions[i*6+4] = (Math.random()-0.5) * jit; // Płasko
            positions[i*6+5] = Math.sin(angle) * r;
        }
        lightningGeo.attributes.position.needsUpdate = true;
        lightningMat.opacity = Math.random();
    }

    function suckParticles(factor) {
        const positions = particles.geometry.attributes.position.array;
        for(let i=0; i < positions.length; i+=3) {
            positions[i] *= factor;
            // Y zostawiamy bez zmian lub minimalnie
            positions[i+2] *= factor;
        }
        particles.geometry.attributes.position.needsUpdate = true;
        particles.material.color.setHex(0xffffff);
        particles.material.opacity = 0.8;
    }

    function update(dt) {
      if (disposed) return;
      time += dt;

      // 1. ŁADOWANIE
      if (time < CHARGE_TIME) {
        const t = time / CHARGE_TIME;
        const pulse = 1.0 + Math.sin(time * 15) * 0.1 * t;
        core.scale.setScalar(pulse);
        
        const lightness = 0.5 + t * 0.5;
        core.material.color.setHSL(0.5, 1.0, lightness);
        
        lightning.visible = true;
        updateLightning(1.2 + t * 0.5);
        
        light.intensity = t * 2.0;
        
        particles.material.opacity = Math.min(1, t * 2.0);
      } 
      // 2. IMPLOZJA
      else if (time < TOTAL_IMPLOSION_END) {
        const localTime = time - CHARGE_TIME;
        const progress = localTime / IMPLOSION_DURATION;
        
        if (progress < 0.5) {
            const s = progress * 2.0; 
            implosionRing.scale.setScalar(s);
            implosionRing.material.opacity = progress * 2.0;
        } else {
            const s = (1.0 - progress) * 4.0; 
            implosionRing.scale.setScalar(s);
        }
        
        core.scale.setScalar(Math.max(0.01, 1.0 - progress));
        suckParticles(0.85);
        lightning.visible = progress < 0.8;
      } 
      // 3. EKSPLOZJA
      else {
        const explosionTime = time - TOTAL_IMPLOSION_END;
        const progress = explosionTime / EXPLOSION_DURATION;

        if (progress >= 1.0) {
            dispose();
            return;
        }

        if (!explosionGroup.visible) {
            explosionGroup.visible = true;
            core.visible = false;
            lightning.visible = false;
            implosionRing.visible = false;
            particles.visible = false;
        }

        const globalFade = 1.0 - Math.pow(progress, 3.0);

        ring1Mat.uniforms.progress.value = progress;
        ring1Mat.uniforms.uGlobalFade.value = globalFade;
        const ringScale = 1.0 + progress * 5.0;
        ring1.scale.set(ringScale * 4, ringScale * 4, 1);

        glowMat.opacity = (1.0 - progress) * 0.8;
        glowSprite.scale.setScalar(2.0 + progress * 8.0);

        const spikeGrow = Math.min(1.0, explosionTime * 10.0);
        const spikeFade = Math.max(0, 1.0 - progress * 1.2);
        
        for(let i=0; i<spikeCount; i++) {
            const m = spikes[i];
            m.scale.set(
                m.userData.widthScale * spikeGrow * spikeFade, 
                m.userData.maxScaleY * spikeGrow * spikeFade, 
                m.userData.widthScale * spikeGrow * spikeFade
            );
        }
        spikeMat.opacity = spikeFade;

        const spkPos = sparks.geometry.attributes.position.array;
        for(let i=0; i<sparkVel.length; i++) {
            const vel = sparkVel[i];
            vel.x *= 0.95; 
            vel.z *= 0.95; // Opór na XZ
            
            spkPos[i*3]   += vel.x * dt * 60; 
            spkPos[i*3+1] += vel.y * dt * 60;
            spkPos[i*3+2] += vel.z * dt * 60;
        }
        sparks.geometry.attributes.position.needsUpdate = true;
        
        const sparkFade = Math.max(0, 1.0 - progress * 1.5);
        sparks.material.opacity = sparkFade;

        light.intensity = (1.0 - progress) * 5.0;
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      
      coreMaterial.dispose(); 
      implosionMat.dispose(); 
      lightningGeo.dispose(); lightningMat.dispose();
      particlesMat.dispose(); pGeo.dispose();
      
      ring1Mat.dispose(); 
      glowMat.dispose(); 
      
      spikeMat.dispose(); 
      sparks.geometry.dispose(); sparks.material.dispose();
    }

    return { group, update, dispose };
  };
}

// --- HELPERY ---

function makeSoftGlow(size, colorCore, colorOuter) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, colorCore);
  gradient.addColorStop(0.2, colorCore);
  gradient.addColorStop(0.5, colorOuter);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSparkTexture(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const center = size / 2;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.4, "rgba(200, 240, 255, 0.2)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.beginPath();
  ctx.ellipse(center, center, size * 0.45, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(center, center, size * 0.45, size * 0.05, Math.PI / 2, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}