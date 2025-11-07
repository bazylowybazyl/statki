import * as THREE from "three";

const sharedTextures = {
  flash: null,
  smoke: null,
  ember: null,
};

const sharedGeometries = {
  spark: null,
  shard: null,
};

function ensureTextures() {
  if (!sharedTextures.flash) {
    sharedTextures.flash = makeRadialTexture(384, "#fff3d6", "rgba(255,200,130,0.92)", "rgba(255,140,60,0)");
  }
  if (!sharedTextures.smoke) {
    sharedTextures.smoke = makeSmokeTexture(256);
  }
  if (!sharedTextures.ember) {
    sharedTextures.ember = makeRadialTexture(256, "#ffe7b8", "rgba(255,180,90,0.85)", "rgba(255,140,60,0)");
  }
}

function ensureGeometries() {
  if (!sharedGeometries.spark) {
    sharedGeometries.spark = new THREE.PlaneGeometry(1, 0.12);
  }
  if (!sharedGeometries.shard) {
    sharedGeometries.shard = new THREE.PlaneGeometry(0.36, 0.08);
  }
}

export function createAutocannonImpactFactory(scene) {
  ensureTextures();
  ensureGeometries();

  return function spawn({ x = 0, y = 0, z, size = 42 } = {}) {
    const group = new THREE.Group();
    group.position.set(x, 0, z !== undefined ? z : y);
    group.scale.setScalar(size);
    scene.add(group);

    const flashMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.flash,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 0.92,
      color: 0xffffff,
    });
    const flash = new THREE.Sprite(flashMaterial);
    flash.scale.setScalar(2.6);
    flash.position.y = 0.12;
    group.add(flash);

    const coreMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.ember,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 1,
      color: 0xffd49a,
    });
    const core = new THREE.Sprite(coreMaterial);
    core.scale.setScalar(1.1);
    core.position.y = 0.24;
    group.add(core);

    const ringGeometry = new THREE.RingGeometry(0.16, 0.38, 40);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcf9c,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    const sparkCount = 32;
    const sparkMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd8a0,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const sparks = new THREE.InstancedMesh(sharedGeometries.spark, sparkMaterial, sparkCount);
    sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    sparks.frustumCulled = false;
    group.add(sparks);

    const sparkTransform = new THREE.Object3D();
    const sparkData = new Array(sparkCount).fill(null).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 52 + Math.random() * 90;
      const life = 0.18 + Math.random() * 0.18;
      const length = 1.6 + Math.random() * 2.2;
      const thickness = 0.12 + Math.random() * 0.16;
      const elevation = 0.04 + Math.random() * 0.18;
      return { angle, speed, life, age: 0, length, thickness, elevation };
    });

    sparkData.forEach((data, i) => {
      sparkTransform.position.set(0, data.elevation, 0);
      sparkTransform.rotation.set(-Math.PI / 2, 0, -data.angle);
      sparkTransform.scale.set(data.length, data.thickness, 1);
      sparkTransform.updateMatrix();
      sparks.setMatrixAt(i, sparkTransform.matrix);
    });
    sparks.instanceMatrix.needsUpdate = true;

    const shardCount = 18;
    const shardMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff0d0,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const shards = new THREE.InstancedMesh(sharedGeometries.shard, shardMaterial, shardCount);
    shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shards.frustumCulled = false;
    group.add(shards);

    const shardTransform = new THREE.Object3D();
    const shardData = new Array(shardCount).fill(null).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 38 + Math.random() * 70;
      const life = 0.24 + Math.random() * 0.22;
      const tilt = (Math.random() - 0.5) * 0.6;
      const scale = 0.8 + Math.random() * 0.8;
      return { angle, speed, life, age: 0, tilt, scale };
    });

    shardData.forEach((data, i) => {
      shardTransform.position.set(0, 0.12, 0);
      shardTransform.rotation.set(-Math.PI / 2 + data.tilt, 0, -data.angle);
      shardTransform.scale.set(data.scale, 0.4 * data.scale, 1);
      shardTransform.updateMatrix();
      shards.setMatrixAt(i, shardTransform.matrix);
    });
    shards.instanceMatrix.needsUpdate = true;

    const smokes = [];
    const baseSmokeMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.smoke,
      color: 0x8493c8,
      transparent: true,
      depthWrite: false,
      opacity: 0.22,
    });
    for (let i = 0; i < 7; i++) {
      const mat = baseSmokeMaterial.clone();
      const smoke = new THREE.Sprite(mat);
      smoke.position.set((Math.random() - 0.5) * 0.6, 0.1 + Math.random() * 0.12, (Math.random() - 0.5) * 0.6);
      const scale = 0.8 + Math.random() * 0.9;
      smoke.scale.setScalar(scale);
      smoke.userData = {
        vx: (Math.random() - 0.5) * 6,
        vz: (Math.random() - 0.5) * 6,
        rise: 0.6 + Math.random() * 0.5,
        growth: 0.9 + Math.random() * 0.7,
        age: 0,
        life: 0.7 + Math.random() * 0.4,
      };
      smokes.push(smoke);
      group.add(smoke);
    }

    const embers = [];
    const emberMaterial = new THREE.SpriteMaterial({
      map: sharedTextures.ember,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      color: 0xffd6a0,
      opacity: 0.85,
    });
    for (let i = 0; i < 10; i++) {
      const mat = emberMaterial.clone();
      const ember = new THREE.Sprite(mat);
      ember.position.set((Math.random() - 0.5) * 0.4, 0.12 + Math.random() * 0.12, (Math.random() - 0.5) * 0.4);
      ember.scale.setScalar(0.22 + Math.random() * 0.26);
      ember.userData = {
        vx: (Math.random() - 0.5) * 22,
        vz: (Math.random() - 0.5) * 22,
        rise: 0.5 + Math.random() * 0.4,
        age: 0,
        life: 0.32 + Math.random() * 0.22,
      };
      embers.push(ember);
      group.add(ember);
    }

    const light = new THREE.PointLight(0xffd09a, 90, 80 * size, 2.2);
    light.position.set(0, 3.2, 0);
    group.add(light);

    const duration = 0.7;
    let time = 0;
    let disposed = false;
    const sizeBoost = Math.sqrt(size / 42);

    function update(dt) {
      if (disposed) return;
      time += dt;

      const flashFade = Math.max(0, 1 - time / 0.08);
      flashMaterial.opacity = 0.92 * flashFade;
      flash.scale.setScalar(2.6 + time * 18);

      const coreFade = Math.max(0, 1 - time / 0.12);
      coreMaterial.opacity = coreFade;
      core.scale.setScalar(1.1 + Math.max(0, 0.4 - time * 2.4));

      ring.scale.setScalar(0.28 + time * 4.2);
      ringMaterial.opacity = 0.85 * Math.max(0, 1 - time / 0.24);

      for (let i = 0; i < sparkData.length; i++) {
        const data = sparkData[i];
        data.age += dt;
        const ageNorm = Math.max(0, 1 - data.age / data.life);
        const dist = data.speed * data.age * 0.02;
        const px = Math.cos(data.angle) * dist;
        const pz = Math.sin(data.angle) * dist;

        sparkTransform.position.set(px, data.elevation, pz);
        sparkTransform.rotation.set(-Math.PI / 2, 0, -data.angle);
        sparkTransform.scale.set(
          data.length * (0.4 + 0.6 * ageNorm),
          data.thickness * (0.4 + 0.6 * ageNorm),
          1,
        );
        sparkTransform.updateMatrix();
        sparks.setMatrixAt(i, sparkTransform.matrix);
      }
      sparks.instanceMatrix.needsUpdate = true;
      sparkMaterial.opacity = 0.9 * Math.max(0, 1 - time / 0.2);

      for (let i = shardData.length - 1; i >= 0; i--) {
        const data = shardData[i];
        data.age += dt;
        const tNorm = Math.max(0, 1 - data.age / data.life);
        const dist = data.speed * data.age * 0.018;
        const px = Math.cos(data.angle) * dist;
        const pz = Math.sin(data.angle) * dist;

        shardTransform.position.set(px, 0.1 + data.age * 0.25, pz);
        shardTransform.rotation.set(-Math.PI / 2 + data.tilt, 0, -data.angle);
        shardTransform.scale.set(data.scale * (0.4 + 0.6 * tNorm), 0.4 * data.scale * (0.3 + 0.7 * tNorm), 1);
        shardTransform.updateMatrix();
        shards.setMatrixAt(i, shardTransform.matrix);
      }
      shards.instanceMatrix.needsUpdate = true;
      shardMaterial.opacity = Math.max(0, 1 - time / 0.28);

      for (let i = embers.length - 1; i >= 0; i--) {
        const ember = embers[i];
        const state = ember.userData;
        state.age += dt;
        ember.position.x += state.vx * dt * 0.04;
        ember.position.z += state.vz * dt * 0.04;
        ember.position.y += state.rise * dt * 0.4;
        const fade = Math.max(0, 1 - state.age / state.life);
        ember.material.opacity = 0.85 * fade * Math.max(0, 1 - time / 0.32);
        if (state.age >= state.life) {
          group.remove(ember);
          ember.material.dispose();
          embers.splice(i, 1);
        }
      }

      for (let i = smokes.length - 1; i >= 0; i--) {
        const smoke = smokes[i];
        const state = smoke.userData;
        state.age += dt;
        smoke.position.x += state.vx * dt * 0.04;
        smoke.position.z += state.vz * dt * 0.04;
        smoke.position.y += state.rise * dt * 0.12;
        smoke.scale.multiplyScalar(1 + state.growth * dt * 0.4);
        const fade = Math.max(0, 1 - state.age / state.life);
        smoke.material.opacity = 0.22 * fade * Math.max(0, 1 - time / 0.6);
        if (state.age >= state.life) {
          group.remove(smoke);
          smoke.material.dispose();
          smokes.splice(i, 1);
        }
      }

      light.intensity = 110 * sizeBoost * Math.max(0, 1 - time / 0.14);

      if (time > duration + 0.5) {
        dispose();
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (group.parent) {
        group.parent.remove(group);
      }
      flashMaterial.dispose();
      coreMaterial.dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      sparkMaterial.dispose();
      sparks.dispose();
      shardMaterial.dispose();
      shards.dispose();
      baseSmokeMaterial.dispose();
      emberMaterial.dispose();
      embers.forEach((ember) => {
        ember.material.dispose();
      });
      smokes.forEach((smoke) => {
        smoke.material.dispose();
      });
    }

    return { group, update, dispose };
  };
}

function makeRadialTexture(size = 256, inner = "#fff6db", mid = "rgba(255,190,90,0.85)", outer = "rgba(255,140,60,0)") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.42, mid);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSmokeTexture(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.48);
  gradient.addColorStop(0, "rgba(220,230,255,0.45)");
  gradient.addColorStop(1, "rgba(220,230,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
