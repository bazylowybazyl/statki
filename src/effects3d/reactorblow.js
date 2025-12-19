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
        float dist = abs(vUv.y - 0.5) * 2.0;
        float ring = 1.0 - pow(dist, 0.5);
        
        float sparks = sin(vUv.x * 100.0 + progress * 20.0) * 0.5 + 0.5;
        ring *= (0.8 + sparks * 0.4);

        vec3 color = vec3(0.2, 0.8, 1.0) * 4.0 * uGlobalFade; 
        
        float fade = 1.0 - smoothstep(0.4, 1.0, progress);
        
        float alpha = ring * fade * uGlobalFade * uOpacity;
        
        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color, alpha);
    }
`;

// --- ZASOBY WSPÓŁDZIELONE ---
const sharedResources = {
  textures: { glow: null, spark: null, glowNew: null },
  geometries: {
    sphere: null, torusImplosion: null, ringInner: null, ringOuter: null,
    planeGlow: null, spike: null,
  }
};

function ensureResources() {
  if (!sharedResources.textures.glow) sharedResources.textures.glow = makeSoftGlow(64, "rgba(255,255,255,1)", "rgba(100,220,255,0.4)");
  if (!sharedResources.textures.glowNew) sharedResources.textures.glowNew = makeSoftGlow(128, "rgba(0, 200, 255, 1)", "rgba(0, 50, 255, 0.2)");
  if (!sharedResources.textures.spark) sharedResources.textures.spark = makeSparkTexture(64);

  if (!sharedResources.geometries.sphere) sharedResources.geometries.sphere = new THREE.SphereGeometry(3, 32, 32);
  if (!sharedResources.geometries.torusImplosion) sharedResources.geometries.torusImplosion = new THREE.TorusGeometry(15, 0.5, 16, 100);
  if (!sharedResources.geometries.ringInner) sharedResources.geometries.ringInner = new THREE.RingGeometry(0.5, 0.8, 64);
  if (!sharedResources.geometries.ringOuter) sharedResources.geometries.ringOuter = new THREE.RingGeometry(0.5, 0.6, 64);
  if (!sharedResources.geometries.planeGlow) sharedResources.geometries.planeGlow = new THREE.PlaneGeometry(15, 15);
  
  if (!sharedResources.geometries.spike) {
    // Stożek/Kolec: promień góry 0, dołu 1, wysokość 1
    sharedResources.geometries.spike = new THREE.CylinderGeometry(0, 1, 1, 4); 
    // Przesuwamy pivot na podstawę, żeby skalowanie odbywało się "od środka" w górę
    sharedResources.geometries.spike.translate(0, 0.5, 0);
  }
}

export function createReactorBlowFactory(scene) {
  ensureResources();

  return function spawn({ x = 0, y = 0, z, size = 1.0 } = {}) {
    const group = new THREE.Group();
    group.position.set(x, 0, z !== undefined ? z : y);
    group.scale.setScalar(size);
    scene.add(group);

    // --- FAZA 1 & 2 ---
    const coreMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffff, toneMapped: false });
    const core = new THREE.Mesh(sharedResources.geometries.sphere, coreMaterial);
    group.add(core);

    const implosionMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0 });
    const implosionRing = new THREE.Mesh(sharedResources.geometries.torusImplosion, implosionMat);
    implosionRing.rotation.x = Math.PI / 2;
    implosionRing.scale.set(0, 0, 0);
    group.add(implosionRing);

    const lightningPos = new Float32Array(40 * 2 * 3);
    const lightningGeo = new THREE.BufferGeometry();
    lightningGeo.setAttribute('position', new THREE.BufferAttribute(lightningPos, 3));
    const lightningMat = new THREE.LineBasicMaterial({ 
        color: 0x88ffff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending 
    });
    const lightning = new THREE.LineSegments(lightningGeo, lightningMat);
    lightning.visible = false;
    group.add(lightning);

    const pCount = 1000;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pVel = new Float32Array(pCount * 3); 
    for(let i=0; i<pCount; i++) {
        const r = Math.random() * 8;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        pPos[i*3] = r * Math.sin(phi) * Math.cos(theta);
        pPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
        pPos[i*3+2] = r * Math.cos(phi);
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const particlesMat = new THREE.PointsMaterial({
        color: 0x00ffff, size: 1.0, map: sharedResources.textures.glow,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0
    });
    const particles = new THREE.Points(pGeo, particlesMat);
    particles.userData = { positions: pPos, velocities: pVel }; 
    group.add(particles);

    const light = new THREE.PointLight(0x00ffff, 0, 300 * size);
    light.position.set(0, 10, 0);
    group.add(light);

    // --- FAZA 3: EKSPLOZJA ---
    const explosionGroup = new THREE.Group();
    explosionGroup.visible = false;
    group.add(explosionGroup);

    // KOLCE (SPIKES)
    const spikeCount = 24;
    const spikeGroup = new THREE.Group();
    const spikeMat = new THREE.MeshBasicMaterial({ 
        color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const spikes = [];
    for(let i=0; i<spikeCount; i++) {
        const mesh = new THREE.Mesh(sharedResources.geometries.spike, spikeMat);
        mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
        mesh.userData = {
            maxScaleY: 20 + Math.random() * 30,
            widthScale: 0.5 + Math.random() * 1.5
        };
        mesh.scale.set(0,0,0);
        spikeGroup.add(mesh);
        spikes.push(mesh);
    }
    explosionGroup.add(spikeGroup);

    const ringUniforms = { progress: { value: 0 }, uGlobalFade: { value: 1.0 }, uOpacity: { value: 1.0 } };
    const ring1Mat = new THREE.ShaderMaterial({
        vertexShader: shockVertex, fragmentShader: shockFragment,
        uniforms: THREE.UniformsUtils.clone(ringUniforms),
        transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const ring1 = new THREE.Mesh(sharedResources.geometries.ringInner, ring1Mat);
    ring1.rotation.x = -Math.PI/2;
    explosionGroup.add(ring1);

    const ring2Mat = new THREE.ShaderMaterial({
        vertexShader: shockVertex, fragmentShader: shockFragment,
        uniforms: THREE.UniformsUtils.clone(ringUniforms),
        transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    ring2Mat.uniforms.uOpacity.value = 0.6;
    const ring2 = new THREE.Mesh(sharedResources.geometries.ringOuter, ring2Mat);
    ring2.rotation.x = -Math.PI/2;
    explosionGroup.add(ring2);

    const glowMat = new THREE.MeshBasicMaterial({
        map: sharedResources.textures.glowNew, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    });
    const groundGlow = new THREE.Mesh(sharedResources.geometries.planeGlow, glowMat);
    groundGlow.rotation.x = -Math.PI/2;
    groundGlow.position.y = 1.0;
    explosionGroup.add(groundGlow);

    // --- ISKRY / ODŁAMKI ---
    const sparkCount = 400;
    const sparkPos = new Float32Array(sparkCount * 3);
    const sparkVel = [];
    for(let i=0; i<sparkCount; i++) {
        // Zmniejszona prędkość początkowa (15-45)
        const speed = 15 + Math.random() * 30; 
        const angle = Math.random() * Math.PI * 2;
        const up = (Math.random() - 0.2) * 1.5;
        sparkVel.push(new THREE.Vector3(Math.cos(angle), up, Math.sin(angle)).normalize().multiplyScalar(speed));
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
        color: 0xffffff, size: 1.2, map: sharedResources.textures.spark, transparent: true, blending: THREE.AdditiveBlending
    }));
    explosionGroup.add(sparks);

    let time = 0;
    let state = 'charging';
    let disposed = false;
    const explosionLifespan = 6.0;

    function updateLightning(radius) {
        const positions = lightningGeo.attributes.position.array;
        for (let i = 0; i < 40; i++) {
            positions[i*6] = (Math.random()-0.5) * 3;
            positions[i*6+1] = (Math.random()-0.5) * 3;
            positions[i*6+2] = (Math.random()-0.5) * 3;
            const r = radius * (0.8 + Math.random()*0.4);
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            positions[i*6+3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i*6+4] = r * Math.sin(phi) * Math.sin(theta);
            positions[i*6+5] = r * Math.cos(phi);
        }
        lightningGeo.attributes.position.needsUpdate = true;
        lightningMat.opacity = Math.random();
    }

    function suckParticles(factor) {
        const positions = particles.geometry.attributes.position.array;
        for(let i=0; i < positions.length; i+=3) {
            positions[i] *= factor;
            positions[i+1] *= factor;
            positions[i+2] *= factor;
        }
        particles.geometry.attributes.position.needsUpdate = true;
        particles.material.color.setHex(0xffffff);
        particles.material.opacity = 0.8;
    }

    function update(dt) {
      if (disposed) return;
      time += dt;

      if (time < 2.5) {
        state = 'charging';
        const pulse = Math.sin(time * 12) * 0.2 + 1;
        core.scale.setScalar(pulse);
        const colorMix = Math.min(1, time / 2.5);
        core.material.color.setHSL(0.5, 1, 0.5 + colorMix * 0.5); 
        lightning.visible = true;
        updateLightning(20 + time * 20);
        light.intensity = time * 30;
        light.color.setHSL(0.5 - time * 0.1, 1, 0.5);
        particles.material.opacity = Math.min(1, time * 0.5);
        particles.material.color.setHex(0x00ffff);
      } else if (time < 3.4) {
        state = 'imploding';
        const implosionTime = time - 2.5; 
        const totalImplosionTime = 0.9;
        const progress = implosionTime / totalImplosionTime;
        if (progress < 0.3) {
            const expandProgress = progress / 0.3;
            const scale = THREE.MathUtils.lerp(0, 4, expandProgress);
            implosionRing.scale.setScalar(scale);
            implosionRing.material.opacity = expandProgress * 0.8;
            implosionRing.material.color.setHex(0x00ffff);
        } else {
            const contractProgress = (progress - 0.3) / 0.7;
            const t = contractProgress * contractProgress * contractProgress;
            const scale = THREE.MathUtils.lerp(4, 0, t); 
            implosionRing.scale.setScalar(scale);
            implosionRing.material.opacity = 1.0; 
            implosionRing.material.color.setHSL(0.5, 1.0, 0.5 + contractProgress * 0.5);
        }
        if (progress < 0.9) core.scale.setScalar(1 - progress * 0.6);
        else { core.scale.setScalar(0.01); core.material.color.setHex(0x000000); }
        updateLightning(8 * (1-progress)); 
        suckParticles(progress > 0.8 ? 0.6 : 0.92);
      } else {
        if (state !== 'exploding') {
            state = 'exploding';
            explosionGroup.visible = true;
        }

        const explosionAge = time - 3.4;
        const progress = explosionAge / explosionLifespan;

        if (progress >= 1.0) {
            dispose();
            return;
        }

        let globalFade = 1.0 - THREE.MathUtils.smoothstep(0.6, 1.0, progress);
        if (progress > 0.98) globalFade = 0.0;

        ring1Mat.uniforms.progress.value = progress;
        ring1Mat.uniforms.uGlobalFade.value = globalFade;
        ring2Mat.uniforms.progress.value = progress;
        ring2Mat.uniforms.uGlobalFade.value = globalFade;
        const s1 = (1.0 + progress * 35.0) * 4.0;
        ring1.scale.set(s1, s1, 1);
        const s2 = (1.0 + progress * 60.0) * 4.0;
        ring2.scale.set(s2, s2, 1);

        const spikeGrow = Math.min(1.0, explosionAge * 8.0);
        const spikeFade = Math.max(0, 1.0 - explosionAge * 1.5);
        for(let i=0; i<spikeCount; i++) {
            const m = spikes[i];
            m.scale.set(
                m.userData.widthScale * spikeGrow * spikeFade, 
                m.userData.maxScaleY * spikeGrow, 
                m.userData.widthScale * spikeGrow * spikeFade
            );
        }
        spikeMat.opacity = spikeFade;

        let glowIntensity = progress < 0.1 ? progress * 10 : 1.0;
        glowMat.opacity = glowIntensity * 0.8 * globalFade;
        groundGlow.scale.setScalar((1.0 + progress * 6.0) * 5.0);

        const spkPos = sparks.geometry.attributes.position.array;
        for(let i=0; i<sparkVel.length; i++) {
            const vel = sparkVel[i];
            // Minimalny opór powietrza (0.992)
            vel.multiplyScalar(0.992); 
            spkPos[i*3]   += vel.x * dt;
            spkPos[i*3+1] += vel.y * dt;
            spkPos[i*3+2] += vel.z * dt;
        }
        sparks.geometry.attributes.position.needsUpdate = true;
        sparks.material.opacity = globalFade;

        let lightInt = progress < 0.1 ? 500 * (progress/0.1) : 500;
        light.intensity = lightInt * globalFade;

        core.visible = false;
        lightning.visible = false;
        implosionRing.visible = false;
        particles.visible = false;
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) group.parent.remove(group);
      coreMaterial.dispose(); implosionMat.dispose(); lightningGeo.dispose(); lightningMat.dispose();
      particlesMat.dispose(); ring1Mat.dispose(); ring2Mat.dispose(); glowMat.dispose(); 
      sparkGeo.dispose(); spikeMat.dispose();
    }

    return { group, update, dispose };
  };
}

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
  ctx.ellipse(center, center, size * 0.45, size * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(center, center, size * 0.45, size * 0.03, Math.PI / 2, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}