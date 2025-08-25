import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

/**
 * Earth Builder – React + Three.js
 * - Prawdziwa kula 3D do gry kosmicznej (jak Starsector, ale interaktywna)
 * - Proceduralna mapa (kontynenty/oceany/chmury) bez zewnętrznych assetów
 * - Kliknij kulę, aby dodać budynek (wieżowiec/fabryka) prostopadle do powierzchni
 * - Opcjonalnie twórz strefy (komercyjna / przemysłowa / mieszkaniowa) jako dyski "przyklejone" do kuli
 */

// ---------- helpery matematyczne ----------
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function latLonToVec3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  return new THREE.Vector3(x, y, z);
}
function vec3ToLatLon(v) {
  const r = v.length();
  const phi = Math.acos(clamp(v.y / r, -1, 1)); // 0..pi
  const theta = Math.atan2(v.z, v.x); // -pi..pi
  const lat = 90 - (phi * 180) / Math.PI;
  const lon = (theta * 180) / Math.PI - 180;
  return { lat, lon };
}

// ---------- procedural textures (JS, kanwa do CanvasTexture) ----------
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
  const cloudNoise = makeValueNoise(rand, 256, 128);

  const day = document.createElement("canvas"); day.width = sizeX; day.height = sizeY;
  const night = document.createElement("canvas"); night.width = sizeX; night.height = sizeY;
  const cloud = document.createElement("canvas"); cloud.width = sizeX; cloud.height = sizeY;

  const dctx = day.getContext("2d");
  const nctx = night.getContext("2d");
  const cctx = cloud.getContext("2d");
  const dimg = dctx.createImageData(sizeX, sizeY);
  const nimg = nctx.createImageData(sizeX, sizeY);
  const cimg = cctx.createImageData(sizeX, sizeY);

  for (let y = 0; y < sizeY; y++) {
    const v = y / (sizeY - 1);
    const latAbs = Math.abs(v - 0.5) * 2;

    for (let x = 0; x < sizeX; x++) {
      const u = x / (sizeX - 1);

      // Earth-like continent guide
      const guide =
        1.35 * bump(u, v, 0.18, 0.42, 0.10, 0.12) + // NA
        1.15 * bump(u, v, 0.23, 0.64, 0.07, 0.10) + // SA
        1.55 * bump(u, v, 0.52, 0.42, 0.22, 0.12) + // Eurasia
        1.25 * bump(u, v, 0.53, 0.58, 0.12, 0.14) + // Africa
        0.90 * bump(u, v, 0.74, 0.62, 0.06, 0.06);  // Australia

      const base = baseNoise(u * 3.2, v * 2.0);
      const detail = roughNoise(u * 6.0, v * 3.0);
      let landMask = base * 0.6 + detail * 0.25 + guide * 0.35;
      landMask -= 0.52 + (latAbs - 0.5) * 0.05; // ocean level
      const isLand = landMask > 0;

      const elev = clamp((detail - 0.5) * 1.6 + (base - 0.5) * 0.6 + guide * 0.2, -1, 1);

      // land color
      let rD, gD, bD;
      if (isLand) {
        const green = 0.35 + 0.25 * (1 - latAbs);
        const brown = elev > 0.25 ? 0.25 + (elev - 0.25) * 0.8 : 0.0;
        rD = 0.18 + brown; gD = 0.35 + green * 0.8; bD = 0.16 + green * 0.2;
      } else {
        const ocean = 0.55 + 0.18 * (roughNoise(u * 0.5, v * 0.5) - 0.5);
        rD = 0.10 * ocean; gD = 0.30 * ocean; bD = 0.65 * ocean;
      }

      const di = (y * sizeX + x) * 4;
      dimg.data[di] = (clamp(rD) * 255) | 0;
      dimg.data[di + 1] = (clamp(gD) * 255) | 0;
      dimg.data[di + 2] = (clamp(bD) * 255) | 0;
      dimg.data[di + 3] = 255;

      // city lights on night map (RGB amber)
      let city = 0;
      if (isLand && latAbs < 0.85) {
        const urban = roughNoise(u * 8, v * 8);
        city = Math.max(0, urban - 0.72) * 5.0;
      }
      nimg.data[di] = (city * 255) | 0;
      nimg.data[di + 1] = (city * 205) | 0;
      nimg.data[di + 2] = (city * 120) | 0;
      nimg.data[di + 3] = 255;

      // cloud alpha
      const macro = cloudNoise(u * 5 + 0.03 * Math.sin(v * 8), v * 3);
      const micro = roughNoise(u * 2, v * 2);
      let cloudA = clamp((macro * 0.7 + micro * 0.3 - 0.58) * 4.0, 0, 1);
      const hadley = Math.exp(-Math.pow((v - 0.48) / 0.10, 2));
      cloudA *= 0.7 + 0.6 * hadley; cloudA *= 1 - Math.pow(latAbs, 2.2);
      cimg.data[di] = 255; cimg.data[di + 1] = 255; cimg.data[di + 2] = 255; cimg.data[di + 3] = (cloudA * 255) | 0;
    }
  }

  dctx.putImageData(dimg, 0, 0);
  nctx.putImageData(nimg, 0, 0);
  cctx.putImageData(cimg, 0, 0);

  const dayTex = new THREE.CanvasTexture(day); dayTex.wrapS = THREE.RepeatWrapping; dayTex.wrapT = THREE.ClampToEdgeWrapping; dayTex.anisotropy = 8;
  const nightTex = new THREE.CanvasTexture(night); nightTex.wrapS = THREE.RepeatWrapping; nightTex.wrapT = THREE.ClampToEdgeWrapping; nightTex.anisotropy = 8;
  const cloudTex = new THREE.CanvasTexture(cloud); cloudTex.wrapS = THREE.RepeatWrapping; cloudTex.wrapT = THREE.ClampToEdgeWrapping; cloudTex.anisotropy = 8;

  return { dayTex, nightTex, cloudTex };
}

// ---------- komponenty sceny ----------
function Earth({ radius = 2, onPlace }) {
  const group = useRef();
  const [textures, setTextures] = useState(null);

  useEffect(() => {
    // generowanie tekstur musi odbywać się po stronie klienta,
    // dlatego odpalamy je dopiero po zamontowaniu komponentu
    setTextures(generateEarthTextures(1024, 512));
  }, []);

  const { dayTex, nightTex, cloudTex } = textures || {};

  const earthMat = useMemo(
    () => dayTex && new THREE.MeshStandardMaterial({ map: dayTex, roughness: 0.95, metalness: 0.0 }),
    [dayTex]
  );
  const cloudMat = useMemo(
    () =>
      cloudTex &&
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(1, 1, 1),
        transparent: true,
        alphaMap: cloudTex,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
      }),
    [cloudTex]
  );

  // subtelna atmosfera
  const atmosphereMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.5, 1.0), transparent: true, opacity: 0.12, side: THREE.BackSide }), []);

  // rotacja chmur i planety (delikatna)
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.03;
  });

  // klik – dodawanie budynków/stref
  const handleClick = (e) => {
    e.stopPropagation();
    const p = e.point.clone(); // world coords
    const normal = p.clone().normalize();
    const { lat, lon } = vec3ToLatLon(p);
    onPlace({ lat, lon, normal, worldPoint: p, radius });
  };
  if (!textures) return null;

  return (
    <group ref={group}>
      {/* nocna półkula jako delikatny add – mieszamy w shaderze prostym poprzez Multiply w postprocessie; tu po prostu lekko dodamy */}
      <mesh position={[0,0,0]} onClick={handleClick}>
        <sphereGeometry args={[radius, 128, 128]} />
        {earthMat && <primitive object={earthMat} attach="material" />}
      </mesh>

      {/* Chmury */}
      <mesh scale={[1.01, 1.01, 1.01]}>
        <sphereGeometry args={[radius, 128, 128]} />
        {cloudMat && <primitive object={cloudMat} attach="material" />}
      </mesh>

      {/* Atmosfera */}
      <mesh scale={[1.06, 1.06, 1.06]}>
        <sphereGeometry args={[radius, 64, 64]} />
        <primitive object={atmosphereMat} attach="material" />
      </mesh>
    </group>
  );
}

function Building({ position, normal, type = "skyscraper", zone }) {
  const group = useRef();

  // orientacja: oś Y do wektora normalnego powierzchni
  useEffect(() => {
    if (!group.current) return;
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, normal.clone().normalize());
    group.current.quaternion.copy(q);
  }, [normal]);

  // parametry brył
  const color = zone === "industrial" ? "#caa15a" : zone === "commercial" ? "#5ac1ff" : zone === "residential" ? "#7ddc6d" : "#ffffff";

  if (type === "factory") {
    return (
      <group ref={group} position={position}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.25, 0.12, 0.25]} />
          <meshStandardMaterial color={color} metalness={0.1} roughness={0.8} />
        </mesh>
        {/* kominy */}
        <mesh position={[0.07, 0.12, 0.05]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.18, 12]} />
          <meshStandardMaterial color="#999999" roughness={0.6} />
        </mesh>
        <mesh position={[-0.08, 0.12, -0.06]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.16, 12]} />
          <meshStandardMaterial color="#9b9b9b" roughness={0.6} />
        </mesh>
      </group>
    );
  }

  // default: wieżowiec
  return (
    <group ref={group} position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.12, 0.5, 0.12]} />
        <meshStandardMaterial color={color} metalness={0.2} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.1, 0.08, 0.1]} />
        <meshStandardMaterial color="#e6f6ff" roughness={0.2} metalness={0.1} />
      </mesh>
    </group>
  );
}

function Zone({ position, normal, radius = 0.28, color = "#5ac1ff" }) {
  const group = useRef();
  useEffect(() => {
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(up, normal.clone().normalize());
    group.current.quaternion.copy(q);
  }, [normal]);

  return (
    <group ref={group} position={position}>
      <mesh>
        <circleGeometry args={[radius, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.18} />
      </mesh>
      <mesh position={[0, 0.002, 0]}> {/* obrys */}
        <ringGeometry args={[radius * 0.92, radius, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

function InteractionLayer({ planetRadius, mode, placeType, zoneType, onAdd }) {
  const { scene, camera, gl } = useThree();
  const [hoverLatLon, setHoverLatLon] = useState(null);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);

  useFrame(() => {
    const { x, y, width, height, top, left } = gl.domElement.getBoundingClientRect();
    const mx = ( (window._lastMouseX ?? (left + width/2)) - left ) / width * 2 - 1;
    const my = - ( (window._lastMouseY ?? (top + height/2)) - top ) / height * 2 + 1;
    raycaster.setFromCamera({ x: mx, y: my }, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);
    const hit = intersects.find((i) => i.object.geometry && i.object.geometry.type === "SphereGeometry");
    if (hit) {
      const p = hit.point.clone();
      const { lat, lon } = vec3ToLatLon(p);
      setHoverLatLon({ lat, lon });
    }
  });

  useEffect(() => {
    const onMove = (e) => { window._lastMouseX = e.clientX; window._lastMouseY = e.clientY; };
    const onClick = (e) => {
      const rect = gl.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);
      const hit = intersects.find((i) => i.object.geometry && i.object.geometry.type === "SphereGeometry");
      if (!hit) return;
      const p = hit.point.clone();
      const normal = p.clone().normalize();
      const { lat, lon } = vec3ToLatLon(p);
      onAdd({ lat, lon, normal, worldPoint: p, mode, placeType, zoneType });
    };
    window.addEventListener("mousemove", onMove);
    gl.domElement.addEventListener("click", onClick);
    return () => { window.removeEventListener("mousemove", onMove); gl.domElement.removeEventListener("click", onClick); };
  }, [camera, gl, onAdd, placeType, mode, raycaster, scene, zoneType]);

  return hoverLatLon ? (
    <HtmlOverlay>
      <div className="absolute left-4 bottom-4 text-xs text-cyan-200/80 font-mono bg-black/40 px-2 py-1 rounded">
        lat: {hoverLatLon.lat.toFixed(2)}°, lon: {hoverLatLon.lon.toFixed(2)}°
      </div>
    </HtmlOverlay>
  ) : null;
}

function HtmlOverlay({ children }) {
  // utility to render arbitrary HTML on top of canvas
  return <>{children}</>;
}

export default function EarthBuilder() {
  const [mode, setMode] = useState("building"); // "building" | "zone"
  const [placeType, setPlaceType] = useState("skyscraper"); // skyscraper | factory
  const [zoneType, setZoneType] = useState("commercial"); // commercial | industrial | residential
  const [items, setItems] = useState([]);

  const R = 2; // planet radius

  const handleAdd = ({ lat, lon, normal, worldPoint, mode, placeType, zoneType }) => {
    if (mode === "zone") {
      setItems((arr) => [
        ...arr,
        { kind: "zone", id: crypto.randomUUID(), position: worldPoint.clone().normalize().multiplyScalar(R + 0.001).toArray(), normal: normal.toArray(), zoneType }
      ]);
    } else {
      const height = placeType === "skyscraper" ? 0.5 : 0.2;
      const pos = normal.clone().multiplyScalar(R + height / 2);
      setItems((arr) => [
        ...arr,
        { kind: "building", id: crypto.randomUUID(), position: pos.toArray(), normal: normal.toArray(), type: placeType, zoneType }
      ]);
    }
  };

  const clearAll = () => setItems([]);

  return (
    <div className="min-h-screen w-full bg-black text-white">
      <div className="absolute z-10 left-4 top-4 space-y-2 bg-black/50 backdrop-blur px-3 py-3 rounded-xl shadow-lg border border-white/10">
        <div className="text-sm font-semibold tracking-wide text-cyan-300">Planet Builder</div>
        <div className="flex gap-2 text-xs">
          <button className={`px-2 py-1 rounded ${mode === "building" ? "bg-cyan-600" : "bg-zinc-800"}`} onClick={() => setMode("building")}>Budynek</button>
          <button className={`px-2 py-1 rounded ${mode === "zone" ? "bg-cyan-600" : "bg-zinc-800"}`} onClick={() => setMode("zone")}>Strefa</button>
        </div>
        {mode === "building" ? (
          <div className="flex items-center gap-2 text-xs">
            <label className="opacity-80">Typ:</label>
            <select value={placeType} onChange={(e) => setPlaceType(e.target.value)} className="bg-zinc-900 border border-white/10 rounded px-2 py-1">
              <option value="skyscraper">Wieżowiec</option>
              <option value="factory">Fabryka</option>
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs">
            <label className="opacity-80">Strefa:</label>
            <select value={zoneType} onChange={(e) => setZoneType(e.target.value)} className="bg-zinc-900 border border-white/10 rounded px-2 py-1">
              <option value="commercial">Komercyjna</option>
              <option value="industrial">Przemysłowa</option>
              <option value="residential">Mieszkaniowa</option>
            </select>
          </div>
        )}
        <button onClick={clearAll} className="text-xs w-full bg-red-600 hover:bg-red-500 transition rounded px-2 py-1">Wyczyść</button>
        <div className="text-[10px] text-white/60">Kliknij planetę, aby dodać obiekt. Przeciągaj myszą, aby obracać.</div>
      </div>

      <Canvas camera={{ position: [0, 3.2, 5.4], fov: 50 }} shadows>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 3, 5]} intensity={1.1} castShadow />
        <pointLight position={[-4, -2, -6]} intensity={0.25} />

        <Earth radius={R} onPlace={handleAdd} />

        {/* Render buildings and zones */}
        {items.map((it) =>
          it.kind === "building" ? (
            <Building key={it.id} position={it.position} normal={new THREE.Vector3(...it.normal)} type={it.type} zone={it.zoneType} />
          ) : (
            <Zone key={it.id} position={it.position} normal={new THREE.Vector3(...it.normal)} color={it.zoneType === "industrial" ? "#caa15a" : it.zoneType === "residential" ? "#7ddc6d" : "#5ac1ff"} />
          )
        )}

        <OrbitControls enableDamping dampingFactor={0.05} minDistance={3.2} maxDistance={10} />
        <InteractionLayer planetRadius={R} mode={mode} placeType={placeType} zoneType={zoneType} onAdd={handleAdd} />
      </Canvas>

      <div className="absolute left-1/2 -translate-x-1/2 bottom-6 text-xs tracking-widest text-cyan-300/70 font-mono select-none">TERRA // SECTOR-PRIME</div>
    </div>
  );
}
