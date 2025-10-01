import * as THREE from 'three';

function buildPirateStation(THREE, opts = {}) {
  const scale = opts.scale ?? 1.0;
  const group = new THREE.Group();
  group.name = opts.name || 'PirateStation';

  const textures = [];

  function makePanelTexture(size = 256) {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#616775';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 220; i++) {
      const w = Math.floor(8 + Math.random() * 28);
      const h = Math.floor(6 + Math.random() * 26);
      const x = Math.floor(Math.random() * (size - w));
      const y = Math.floor(Math.random() * (size - h));
      const g = 150 + Math.floor(Math.random() * 70);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.push(tex);
    return tex;
  }

  function makeGlowTexture(size = 128) {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.push(tex);
    return tex;
  }

  function makeArrowTexture(txt = '>>>') {
    const w = 256;
    const h = 128;
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.shadowColor = 'rgba(255,70,70,0.95)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#ff4a4a';
    ctx.font = 'bold 86px system-ui,Segoe UI,Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, w / 2, h / 2 + 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.push(tex);
    return tex;
  }

  function makeTickerTexture() {
    const W = 2048;
    const H = 256;
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#001015';
    ctx.fillRect(0, 0, W, H);
    const messages = [
      '☠   BLACK FLAG  ☠',
      'NO QUARTER',
      'DEAD MEN TELL NO TALES',
      'WANTED: MERCHANT CONVOY',
      'RAID TONIGHT 22:00 GST',
      'BOUNTY 50 000 CR'
    ];
    ctx.font = 'bold 140px system-ui,Segoe UI,Arial';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let x = 40;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      ctx.save();
      ctx.shadowColor = i % 2 ? '#2bf0ff' : '#ff3b3b';
      ctx.shadowBlur = 24;
      ctx.fillStyle = i % 2 ? '#8ef5ff' : '#ff7a7a';
      ctx.fillText(msg, x, H / 2);
      ctx.restore();
      x += ctx.measureText(msg).width + 120;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(2, 1);
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.push(tex);
    return tex;
  }

  const panelTex = makePanelTexture(256);

  const metal = new THREE.MeshStandardMaterial({
    map: panelTex,
    color: 0x9aa2ad,
    metalness: 0.7,
    roughness: 0.38
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x2c3138,
    metalness: 0.85,
    roughness: 0.55
  });
  const matteDark = new THREE.MeshStandardMaterial({
    color: 0x1b1f26,
    metalness: 0.35,
    roughness: 0.9
  });

  const coreRadius = 6 * scale;
  const coreHeight = 22 * scale;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(coreRadius, coreRadius, coreHeight, 28, 1, false), metal);
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  const capBot = new THREE.Mesh(new THREE.CylinderGeometry(coreRadius, coreRadius * 0.35, 4 * scale, 24), darkMetal);
  capBot.position.y = -coreHeight * 0.5 - 2 * scale;
  group.add(capBot);

  const resR = coreRadius * 1.25;
  const resH = 6 * scale;
  const res = new THREE.Mesh(new THREE.CylinderGeometry(resR, resR * 0.98, resH, 32, 1, false), metal);
  res.position.y = coreHeight * 0.5 + resH * 0.5 + 0.5 * scale;
  res.castShadow = true;
  res.receiveShadow = true;
  group.add(res);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(resR * 0.92, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), darkMetal);
  dome.position.y = res.position.y + resH * 0.5 - 0.2 * scale;
  group.add(dome);

  function addCurvedWindowBands(radius, yLevels, palette, offProb = 0.15, segLen = Math.PI / 28) {
    const rWin = radius + 0.02 * scale;
    const litGeo = new THREE.CylinderGeometry(rWin, rWin, 0.22 * scale, 8, 1, true, 0, segLen);
    const darkGeo = litGeo.clone();

    const litMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0xffffff,
      side: THREE.DoubleSide
    });
    const darkMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      blending: THREE.NormalBlending,
      depthWrite: false,
      color: 0x05070a,
      side: THREE.DoubleSide
    });

    const maxSeg = yLevels.length * 128;
    const litInst = new THREE.InstancedMesh(litGeo, litMat, maxSeg);
    const darkInst = new THREE.InstancedMesh(darkGeo, darkMat, maxSeg);
    const m = new THREE.Matrix4();
    let li = 0;
    let di = 0;

    function pickColor() {
      const p = palette[Math.floor(Math.random() * palette.length)];
      if (Array.isArray(p)) return new THREE.Color().setHSL(p[0], p[1], p[2]);
      return new THREE.Color(p);
    }

    for (const yOff of yLevels) {
      const count = 72;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        if (Math.random() < 0.28) continue;
        m.identity();
        m.makeRotationY(theta);
        m.setPosition(0, yOff, 0);
        if (Math.random() < offProb) {
          darkInst.setMatrixAt(di++, m);
        } else {
          litInst.setMatrixAt(li, m);
          litInst.setColorAt(li++, pickColor());
        }
      }
    }
    litInst.count = li;
    darkInst.count = di;
    group.add(darkInst);
    group.add(litInst);
    return { litInst, darkInst };
  }

  const upperLevels = [
    res.position.y + 0.0 * scale,
    res.position.y - 0.6 * scale,
    res.position.y + 0.6 * scale
  ];
  addCurvedWindowBands(resR, upperLevels, [0xff5a5a, 0xffffff], 0.15);

  const lowerY = [];
  for (let i = 0; i < 8; i++) lowerY.push((0 - 0.8 * scale) - i * 1.2 * scale);
  addCurvedWindowBands(coreRadius, lowerY, [0xff4040, 0xff77ff, 0xc24bff, 0x8e2bff, 0xffffff], 0.2);

  const ringR = 18 * scale;
  const ringT = 2.4 * scale;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, ringT, 20, 72), metal);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);

  const spokeGeo = new THREE.CylinderGeometry(0.9 * scale, 0.9 * scale, ringR * 2 - 4 * scale, 12);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.rotation.y = i * Math.PI / 2;
    const spoke = new THREE.Mesh(spokeGeo, darkMetal);
    spoke.rotation.z = Math.PI / 2;
    g.add(spoke);
    group.add(g);
  }

  const hRingY = 3.2 * scale;
  const hangarRingR = ringR;
  const hangarRing = new THREE.Mesh(new THREE.TorusGeometry(hangarRingR, 1.0 * scale, 16, 64), darkMetal);
  hangarRing.position.y = hRingY;
  hangarRing.rotation.x = Math.PI / 2;
  group.add(hangarRing);

  const glowTex = makeGlowTexture(256);
  const beacons = [];
  function addBeacon(position, color = 0xff3b3b, phase = 0) {
    const beacon = new THREE.Group();
    beacon.position.copy(position);
    const light = new THREE.PointLight(color, 0, 80 * scale, 2.0);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26 * scale, 12, 12), new THREE.MeshBasicMaterial({ color }));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex,
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false
    }));
    sprite.scale.set(2.4 * scale, 2.4 * scale, 1);
    beacon.add(light, bulb, sprite);
    group.add(beacon);
    beacons.push({ light, sprite, phase });
  }
  addBeacon(new THREE.Vector3(0, res.position.y + resH * 0.6, 0), 0xff3b3b, 0.0);
  addBeacon(new THREE.Vector3(0, -coreHeight * 0.5 - 4.2 * scale, 0), 0x39a3ff, 0.7);

  const tickerTex = makeTickerTexture();
  const screenH = 2.6 * scale;
  const screenR = ringR + ringT + 2.8 * scale;
  const screenGeo = new THREE.CylinderGeometry(screenR, screenR, screenH, 128, 1, true);
  const screenMat = new THREE.MeshBasicMaterial({
    map: tickerTex,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.rotation.y = Math.PI;
  screen.renderOrder = 0;
  group.add(screen);

  const arrowTexFwd = makeArrowTexture('>>>');
  const arrowTexBack = makeArrowTexture('<<<');
  const guidance = [];
  const planeGeo = new THREE.PlaneGeometry(3.2 * scale, 1.5 * scale);

  function addDoorOnCore(angle, y) {
    const wDoor = 3.2 * scale;
    const hDoor = 3.2 * scale;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(wDoor, hDoor), new THREE.MeshBasicMaterial({
      color: 0x05070a,
      transparent: true,
      opacity: 0.95
    }));
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    door.position.set(Math.cos(angle) * (coreRadius + 0.03 * scale), y, Math.sin(angle) * (coreRadius + 0.03 * scale));
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    door.quaternion.copy(quat);
    door.renderOrder = 3;
    door.material.depthWrite = false;
    group.add(door);

    const frameMat = new THREE.MeshBasicMaterial({
      color: 0xff4444,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide
    });
    const fw = wDoor;
    const fh = 0.1 * scale;
    const fd = 0.001;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), frameMat);
    const bot = top.clone();
    const left = new THREE.Mesh(new THREE.PlaneGeometry(fh, hDoor), frameMat);
    const right = left.clone();
    top.position.copy(door.position);
    top.quaternion.copy(door.quaternion);
    top.position.y += hDoor * 0.5 + fd;
    bot.position.copy(door.position);
    bot.quaternion.copy(door.quaternion);
    bot.position.y -= hDoor * 0.5 - fd;
    left.position.copy(door.position);
    left.quaternion.copy(door.quaternion);
    left.position.x += (-Math.sin(angle)) * (0.5 * wDoor - fh * 0.5);
    left.position.z += Math.cos(angle) * (0.5 * wDoor - fh * 0.5);
    right.position.copy(door.position);
    right.quaternion.copy(door.quaternion);
    right.position.x -= (-Math.sin(angle)) * (0.5 * wDoor - fh * 0.5);
    right.position.z -= Math.cos(angle) * (0.5 * wDoor - fh * 0.5);
    group.add(top, bot, left, right);
  }

  function makeArrowMaterial(tex) {
    return new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xff4040,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      opacity: 0.6
    });
  }

  function addGuidanceArrows(angle) {
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
    const distToCore = hangarRingR - coreRadius - 1.2 * scale;
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(2.2 * scale, 1.2 * scale, distToCore), darkMetal);
    const bridgePos = new THREE.Vector3().copy(dir).multiplyScalar(coreRadius + distToCore * 0.5 + 0.6 * scale);
    bridge.position.set(bridgePos.x, hRingY + 0.5 * scale, bridgePos.z);
    bridge.lookAt(0, hRingY + 0.5 * scale, 0);
    group.add(bridge);

    addDoorOnCore(angle + Math.PI, hRingY + 0.8 * scale);

    const laneOffset = 1.8 * scale;
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(up, dir).normalize();
    const count = 8;
    const startDist = 10 * scale;
    const endDist = 20 * scale;

    for (let i = 0; i < count; i++) {
      const mat = makeArrowMaterial(arrowTexFwd);
      const mesh = new THREE.Mesh(planeGeo, mat);
      const t = i / (count - 1);
      const dist = endDist * (1.0 - t) + startDist * t;
      const pos = new THREE.Vector3().copy(dir).multiplyScalar(dist).add(side.clone().multiplyScalar(laneOffset));
      mesh.position.set(pos.x, hRingY + 0.02 * scale, pos.z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.atan2(-dir.z, -dir.x);
      group.add(mesh);
      guidance.push({ mesh, phase: i * 0.22, speed: 6.0 });
    }

    for (let i = 0; i < count; i++) {
      const mat = makeArrowMaterial(arrowTexBack);
      const mesh = new THREE.Mesh(planeGeo, mat);
      const t = i / (count - 1);
      const dist = startDist + (endDist - startDist) * t;
      const pos = new THREE.Vector3().copy(dir).multiplyScalar(dist).add(side.clone().multiplyScalar(-laneOffset));
      mesh.position.set(pos.x, hRingY + 0.02 * scale, pos.z);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.atan2(dir.z, dir.x);
      group.add(mesh);
      guidance.push({ mesh, phase: i * 0.22 + 1.0, speed: 6.0 });
    }
  }

  addGuidanceArrows(0);
  addGuidanceArrows(Math.PI / 2);
  addGuidanceArrows(Math.PI);
  addGuidanceArrows(3 * Math.PI / 2);

  function update(time, dt) {
    for (const b of beacons) {
      const pulse = 0.45 + 0.55 * Math.max(0, Math.sin(time * 3.0 + b.phase));
      if (b.sprite?.material) {
        b.sprite.material.opacity = 0.25 + 0.75 * pulse;
        b.sprite.scale.setScalar((1.7 + 1.3 * pulse) * scale);
      }
      if (b.light) b.light.intensity = 12 * pulse;
    }
    if (tickerTex) tickerTex.offset.x = (tickerTex.offset.x - dt * 0.12) % 1;
    for (const g of guidance) {
      const p = Math.sin(time * g.speed + g.phase);
      const sc = 1.0 + 0.1 * Math.max(0, p);
      if (g.mesh?.material) g.mesh.material.opacity = 0.25 + 0.75 * Math.max(0, p);
      g.mesh?.scale.set(sc, sc, 1);
    }
  }

  const radius = ringR + 30 * scale;
  group.userData.update = update;
  group.userData.radius = radius;
  group.userData.textures = textures;

  return { group, update, radius };
}

export function createPirateStation(opts = {}) {
  const { group, update, radius } = buildPirateStation(THREE, {
    scale: opts.scale ?? 1,
    name: opts.name || 'PirateStation'
  });
  return {
    object3d: group,
    update,
    radius,
    dispose() {
      group.traverse((node) => {
        const material = node.material;
        const geometry = node.geometry;
        if (material) {
          if (Array.isArray(material)) {
            material.forEach((m) => {
              if (m.map?.dispose) m.map.dispose();
              if (m.dispose) m.dispose();
            });
          } else {
            if (material.map?.dispose) material.map.dispose();
            if (material.dispose) material.dispose();
          }
        }
        if (geometry?.dispose) geometry.dispose();
      });
      const tex = group.userData?.textures;
      if (Array.isArray(tex)) {
        for (const t of tex) {
          if (t?.dispose) t.dispose();
        }
      }
    }
  };
}
